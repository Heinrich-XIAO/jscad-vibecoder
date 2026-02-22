require('/jscad-libs/compat/v1.js');

(function() {
if(typeof window.jscad !== 'object') { window.jscad = new Object(); }
if(typeof window.jscad.tspi !== 'object') { window.jscad.tspi = new Object(); }

function createRackToothPolygon(pitch, addendum, dedendum, pressureAngle, resolution) {
	var points = [];
	var paRad = pressureAngle * Math.PI / 180;
	var toothHalfThicknessAtPitch = pitch / 4.0;
	
	// Left involute curve (from root to tip)
	for(var i = 0; i <= resolution; i++) {
		var t = i / resolution;
		var y = -dedendum + t * (addendum + dedendum);
		// Involute-like offset: at pitch line (y=0), slope is pressureAngle
		// The offset from the vertical line follows an involute approximation
		var invOffset = y * Math.tan(paRad);
		// Add slight curvature to match gear appearance
		var curvatureCorrection = 0.15 * (y * y / (addendum + dedendum)) * Math.tan(paRad);
		var x = -toothHalfThicknessAtPitch - invOffset + curvatureCorrection;
		points.push(new CSG.Vector2D(x, y));
	}
	
	// Top tip
	points.push(new CSG.Vector2D(-toothHalfThicknessAtPitch + addendum * Math.tan(paRad), addendum));
	points.push(new CSG.Vector2D(toothHalfThicknessAtPitch - addendum * Math.tan(paRad), addendum));
	
	// Right involute curve (from tip to root)
	for(var i = 0; i <= resolution; i++) {
		var t = 1 - (i / resolution);
		var y = -dedendum + t * (addendum + dedendum);
		var invOffset = y * Math.tan(paRad);
		var curvatureCorrection = 0.15 * (y * y / (addendum + dedendum)) * Math.tan(paRad);
		var x = toothHalfThicknessAtPitch + invOffset - curvatureCorrection;
		points.push(new CSG.Vector2D(x, y));
	}
	
	return new CSG.Polygon2D(points);
}

window.jscad.tspi.involuteRack = function(printer, params) {
	params = params || {};
	printer = printer || {};

	var knownParameters = [
		{ name: 'module', type: 'number', default: 1 },
		{ name: 'teethNumber', type: 'number', default: 20 },
		{ name: 'length', type: 'number', default: -1 },
		{ name: 'pressureAngle', type: 'number', default: 20 },
		{ name: 'clearance', type: 'number', default: 0 },
		{ name: 'thickness', type: 'number', default: 8 },
		{ name: 'backHeight', type: 'number', default: 2 },
	];

	this.parameters = { };
	this.printer = { };
	this.error = false;

	for(var i = 0; i < knownParameters.length; i++) {
		if(typeof(params[knownParameters[i].name]) === knownParameters[i].type) {
			this.parameters[knownParameters[i].name] = params[knownParameters[i].name];
		} else if(knownParameters[i].default !== -1) {
			this.parameters[knownParameters[i].name] = knownParameters[i].default;
		} else {
			this.parameters[knownParameters[i].name] = 0;
		}
	}
	this.printer = Object.assign(this.printer, this.parameters, this.printer);
	this.error = this.error ? this.error : false;

	this.module = this.parameters['module'];
	this.pressureAngle = this.parameters['pressureAngle'];
	this.clearance = this.parameters['clearance'];
	this.thickness = this.parameters['thickness'];
	this.backHeight = this.parameters['backHeight'];
	this.circularPitch = this.module * Math.PI;

	var inputLength = this.parameters['length'];
	var inputTeethNumber = this.parameters['teethNumber'];

	if(inputLength > 0) {
		var teethFromLength = inputLength / this.circularPitch;
		var roundedTeeth = Math.round(teethFromLength);
		var tolerance = 1e-9;
		if(Math.abs(teethFromLength - roundedTeeth) > tolerance) {
			throw new Error('Invalid rack length: length must be an exact multiple of circular pitch (module * PI). Use teethNumber for automatic sizing.');
		}
		this.teethNumber = Math.max(1, roundedTeeth);
		this.length = this.teethNumber * this.circularPitch;
	} else {
		this.teethNumber = inputTeethNumber > 0 ? Math.round(inputTeethNumber) : 20;
		this.length = this.teethNumber * this.circularPitch;
	}

	this.addendum = this.module;
	this.dedendum = this.addendum + this.clearance;
	this.pitchLineY = 0;
	this.phaseOriginX = -this.length / 2.0;

	this.getPitchFeatures = function() {
		return {
			type: 'pitch_line',
			pitchLine: {
				point: [0, this.pitchLineY, 0],
				direction: [1, 0, 0],
				normal: [0, 1, 0]
			},
			module: this.module,
			pressureAngle: this.pressureAngle,
			circularPitch: this.circularPitch,
			teethNumber: this.teethNumber,
			length: this.length,
			source: 'metadata'
		};
	};

	this.getKinematicDefaults = function() {
		return {
			progressName: 'progress',
			progressRange: [0, 1],
			travelAxis: [1, 0, 0],
			travelPerProgress: this.length,
			module: this.module,
			teethNumber: this.teethNumber,
			length: this.length
		};
	};

	this.getPhaseMetadata = function() {
		return {
			kind: 'rack_phase',
			phaseOrigin: [this.phaseOriginX, this.pitchLineY, 0],
			phaseAxis: [1, 0, 0],
			pitchLineY: this.pitchLineY,
			circularPitch: this.circularPitch,
			effectiveLength: this.length,
			effectiveTeethNumber: this.teethNumber,
			referenceToothCenterAtStart: this.phaseOriginX + this.circularPitch / 2,
			description: 'Rack pitch-line phase origin is the left edge at x=-length/2. Tooth centers are offset by half circular pitch.'
		};
	};

	this.getModel = function() {
		var pitch = this.circularPitch;
		var resolution = 8;
		
		var singleTooth = createRackToothPolygon(pitch, this.addendum, this.dedendum, this.pressureAngle, resolution).extrude({ offset: [0, 0, this.thickness] }).rotateZ(180);

		var baseWidth = this.length;
		var baseHeight = this.backHeight > 0 ? this.backHeight : this.module * 2;
		var overlap = Math.max(0.01, this.module * 0.02);
		var baseTop = -this.dedendum + overlap;
		var basePoints = [
			[-baseWidth / 2, baseTop],
			[baseWidth / 2, baseTop],
			[baseWidth / 2, baseTop - baseHeight],
			[-baseWidth / 2, baseTop - baseHeight]
		];
		var basePolygon = new CSG.Polygon2D(basePoints.map(p => new CSG.Vector2D(p[0], p[1])));
		var baseBar = basePolygon.extrude({ offset: [0, 0, this.thickness] });

		var rackTeeth = null;
		for(var i = 0; i < this.teethNumber; i++) {
			var offset = (-this.length / 2.0) + (i + 0.5) * pitch;
			var tooth = singleTooth.translate([offset, 0, 0]);
			rackTeeth = rackTeeth ? union(rackTeeth, tooth) : tooth;
		}

		var translateOffset = [0, 0, -this.thickness / 2.0];
		var shiftedBase = baseBar.translate(translateOffset);
		if (rackTeeth) {
			return union(shiftedBase, rackTeeth.translate(translateOffset));
		}
		return shiftedBase;
	};
};

window.jscad.tspi.rack = function(printer, length, thickness, module, teethNumber, pressureAngle, clearance, backHeight) {
	return new window.jscad.tspi.involuteRack(printer, {
		length: typeof(length) === 'number' && length > 0 ? length : -1,
		thickness: typeof(thickness) === 'number' && thickness > 0 ? thickness : 8,
		module: typeof(module) === 'number' && module > 0 ? module : 1,
		teethNumber: typeof(teethNumber) === 'number' && teethNumber > 0 ? teethNumber : 20,
		pressureAngle: typeof(pressureAngle) === 'number' && pressureAngle > 0 ? pressureAngle : 20,
		clearance: typeof(clearance) === 'number' ? clearance : 0,
		backHeight: typeof(backHeight) === 'number' ? backHeight : 2,
	});
};
})();
