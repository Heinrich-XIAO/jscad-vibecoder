require('/jscad-libs/compat/v1.js');

(function() {
if(typeof window.jscad !== 'object') { window.jscad = new Object(); }
if(typeof window.jscad.tspi !== 'object') { window.jscad.tspi = new Object(); }

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
		}
	}

	this.module = this.parameters['module'];
	this.pressureAngle = this.parameters['pressureAngle'];
	this.clearance = this.parameters['clearance'];
	this.thickness = this.parameters['thickness'];
	this.backHeight = this.parameters['backHeight'];
	this.circularPitch = this.module * Math.PI;

	var inputLength = this.parameters['length'];
	var inputTeethNumber = this.parameters['teethNumber'];

	if(inputLength > 0) {
		this.teethNumber = Math.max(1, Math.round(inputLength / this.circularPitch));
		this.length = this.teethNumber * this.circularPitch;
	} else {
		this.teethNumber = inputTeethNumber > 0 ? Math.round(inputTeethNumber) : 20;
		this.length = this.teethNumber * this.circularPitch;
	}

	this.addendum = this.module;
	this.dedendum = this.addendum + this.clearance;

	this.getModel = function() {
		var paRad = this.pressureAngle * Math.PI / 180;
		var pitch = this.circularPitch;
		
		// Trapezoidal tooth profile
		// Width at pitch line is pitch/2
		var dx_top = this.addendum * Math.tan(paRad);
		var dx_bottom = this.dedendum * Math.tan(paRad);
		var toothHalfThickness = pitch / 4.0;

		var outlinePoints = [];
		// We define one tooth centered at x=0
		// Bottom left
		outlinePoints.push([ -toothHalfThickness - dx_bottom, -this.dedendum ]);
		// Top left
		outlinePoints.push([ -toothHalfThickness + dx_top, this.addendum ]);
		// Top right
		outlinePoints.push([ toothHalfThickness - dx_top, this.addendum ]);
		// Bottom right
		outlinePoints.push([ toothHalfThickness + dx_bottom, -this.dedendum ]);

		var toothPolygon = new CSG.Polygon2D(outlinePoints.map(p => new CSG.Vector2D(p[0], p[1])));
		var singleTooth = toothPolygon.extrude({ offset: [0, 0, this.thickness] });

		// Base/Backing bar
		var baseWidth = this.length;
		var baseHeight = this.backHeight > 0 ? this.backHeight : this.module * 2;
		var basePoints = [
			[-baseWidth / 2, -this.dedendum],
			[baseWidth / 2, -this.dedendum],
			[baseWidth / 2, -this.dedendum - baseHeight],
			[-baseWidth / 2, -this.dedendum - baseHeight]
		];
		var basePolygon = new CSG.Polygon2D(basePoints.map(p => new CSG.Vector2D(p[0], p[1])));
		var baseBar = basePolygon.extrude({ offset: [0, 0, this.thickness] });

		var rack = baseBar;
		for(var i = 0; i < this.teethNumber; i++) {
			var offset = (-this.length / 2.0) + (i + 0.5) * pitch;
			rack = rack.union(singleTooth.translate([offset, 0, 0]));
		}

		return rack.translate([0, 0, -this.thickness / 2.0]);
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
