require('/jscad-libs/compat/v1.js');

(function() {
if(typeof window.jscad !== 'object') { window.jscad = new Object(); }
if(typeof window.jscad.tspi !== 'object') { window.jscad.tspi = new Object(); }

function createRackFlankPoints(baseRadius, angularToothWidthAtBase, maxAngle, resolution, angleFn) {
	var steps = Math.max(1, resolution);
	var halfAngularWidth = angularToothWidthAtBase / 2.0;
	var points = [];
	for(var i = 0; i <= steps; i++) {
		var normalizedPosition = Math.pow(i / steps, 2 / 3);
		var currentAngle = maxAngle * normalizedPosition;
		var angle = angleFn(currentAngle);
		var radialHeight = baseRadius * (Math.sqrt(1 + currentAngle * currentAngle) - 1);
		var x = baseRadius * (angle - halfAngularWidth);
		points.push(new CSG.Vector2D(x, radialHeight));
	}
	return points;
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
		{ name: 'resolution', type: 'number', default: 5 },
	];

	var knownPrinterParameters = [
		{ name: 'scale', type: 'number', default: 1 },
		{ name: 'correctionInsideDiameter', type: 'number', default: 0 },
		{ name: 'correctionOutsideDiameter', type: 'number', default: 0 },
		{ name: 'resolutionCircle', type: 'number', default: 360 },
	];

	this.parameters = { };
	this.printer = { };
	this.error = false;

	for(var i = 0; i < knownParameters.length; i++) {
		if(typeof(params[knownParameters[i].name]) === knownParameters[i].type) {
			this.parameters[knownParameters[i].name] = params[knownParameters[i].name];
		} else if(knownParameters[i].default != -1) {
			this.parameters[knownParameters[i].name] = knownParameters[i].default;
		} else {
			this.error = false;
		}
	}
	for(i = 0; i < knownPrinterParameters.length; i++) {
		if(typeof(printer[knownPrinterParameters[i].name]) === knownPrinterParameters[i].type) {
			this.printer[knownPrinterParameters[i].name] = printer[knownPrinterParameters[i].name];
		} else if(knownPrinterParameters[i].default != -1) {
			this.printer[knownPrinterParameters[i].name] = knownPrinterParameters[i].default;
		} else {
			this.error = false;
		}
	}

	this.module = this.parameters['module'];
	this.pressureAngle = this.parameters['pressureAngle'];
	this.clearance = this.parameters['clearance'];
	this.thickness = this.parameters['thickness'];
	this.resolution = this.parameters['resolution'];
	this.circularPitch = this.module * Math.PI;

	var inputLength = this.parameters['length'];
	var inputTeethNumber = this.parameters['teethNumber'];

	if(inputLength > 0) {
		this.teethNumber = Math.max(1, Math.round(inputLength / this.circularPitch));
		if(this.teethNumber <= 0) {
			this.teethNumber = 1;
		}
		this.length = this.teethNumber * this.circularPitch;
	} else {
		this.teethNumber = inputTeethNumber > 0 ? Math.round(inputTeethNumber) : 20;
		this.length = this.teethNumber * this.circularPitch;
	}

	this.pitchDiameter = this.module * this.teethNumber;
	this.pitchRadius = this.pitchDiameter / 2.0;
	this.circularToothThickness = this.circularPitch / 2.0;
	this.baseCircleDiameter = this.pitchDiameter * Math.cos(this.pressureAngle * Math.PI/180.0);
	this.baseCircleRadius = this.baseCircleDiameter / 2.0;
	this.addendum = this.module;
	this.dedendum = this.addendum + this.clearance;
	this.outsideDiameter = this.pitchDiameter + 2*this.addendum;
	this.outsideRadius = this.outsideDiameter / 2.0;
	this.rootDiameter = this.pitchDiameter - 2*this.dedendum;
	this.rootRadius = this.rootDiameter / 2.0;

	this.getModel = function() {
		var maxTangentLength = Math.sqrt(this.outsideRadius*this.outsideRadius - this.baseCircleRadius*this.baseCircleRadius);
		var maxAngle = maxTangentLength / this.baseCircleRadius;

		var tangentAtPitchCircle = Math.sqrt(this.pitchRadius*this.pitchRadius - this.baseCircleRadius*this.baseCircleRadius);
		var angleAtPitchCircle = tangentAtPitchCircle / this.baseCircleRadius;
		var angularDifference = angleAtPitchCircle - Math.atan(angleAtPitchCircle);
		var angularToothWidthBase = Math.PI / this.teethNumber + 2 * angularDifference;

		var leftFlank = createRackFlankPoints(this.baseCircleRadius, angularToothWidthBase, maxAngle, this.resolution, function(currentAngle) {
			return currentAngle;
		});

		var rightFlank = createRackFlankPoints(this.baseCircleRadius, angularToothWidthBase, maxAngle, this.resolution, function(currentAngle) {
			return angularToothWidthBase - currentAngle;
		});
		rightFlank.reverse();

		var baseHalfWidth = this.baseCircleRadius * (angularToothWidthBase / 2.0);

		var outlinePoints = [];
		outlinePoints.push(new CSG.Vector2D(-baseHalfWidth, -this.dedendum));
		outlinePoints = outlinePoints.concat(leftFlank);
		outlinePoints = outlinePoints.concat(rightFlank);
		outlinePoints.push(new CSG.Vector2D(baseHalfWidth, -this.dedendum));

		var toothPolygon = new CSG.Polygon2D(outlinePoints);
		var singleTooth = toothPolygon.extrude({ offset: [0, 0, this.thickness] });

		var rack = new CSG();
		for(var toothIndex = 0; toothIndex < this.teethNumber; toothIndex++) {
			var offset = (-this.length / 2.0) + (toothIndex + 0.5) * this.circularPitch;
			rack = rack.unionForNonIntersecting(singleTooth.translate([offset, 0, 0]));
		}

		return rack.translate([0,0,-this.thickness/2.0]);
	};
};

window.jscad.tspi.rack = function(printer, length, thickness, module, teethNumber, pressureAngle, clearance) {
	var rackLength = typeof(length) === 'number' && length > 0 ? length : -1;
	var rackThickness = typeof(thickness) === 'number' && thickness > 0 ? thickness : 8;
	var rackModule = typeof(module) === 'number' && module > 0 ? module : 1;
	var rackTeethNumber = typeof(teethNumber) === 'number' && teethNumber > 0 ? teethNumber : 20;
	var rackPressureAngle = typeof(pressureAngle) === 'number' && pressureAngle > 0 ? pressureAngle : 20;
	var rackClearance = typeof(clearance) === 'number' ? clearance : 0;

	return new window.jscad.tspi.involuteRack(printer, {
		length: rackLength,
		thickness: rackThickness,
		module: rackModule,
		teethNumber: rackTeethNumber,
		pressureAngle: rackPressureAngle,
		clearance: rackClearance,
	});
};
})();
