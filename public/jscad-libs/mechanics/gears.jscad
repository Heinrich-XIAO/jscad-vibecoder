require('/jscad-libs/compat/v1.js');

(function() {
if(typeof window.jscad !== 'object') { window.jscad = new Object(); }
if(typeof window.jscad.tspi !== 'object') { window.jscad.tspi = new Object(); }

function createSingleToothPolygon(maxAngle, baseRadius, angularToothWidthAtBase, resolution) {
	var points = [new CSG.Vector2D(0,0)];
	for(var i = 0; i <= resolution; i++) {
		var normalizedPosition = Math.pow(i / resolution, 2 / 3);
		var currentAngle = maxAngle * normalizedPosition;
		var tanLength = currentAngle * baseRadius;

		var radialVector = CSG.Vector2D.fromAngle(currentAngle);
		var tangentialVector = radialVector.normal().times(-tanLength);
		var point = radialVector.times(baseRadius).plus(tangentialVector);
		points[i + 1] = point;

		radialVector = CSG.Vector2D.fromAngle(angularToothWidthAtBase - currentAngle);
		tangentialVector = radialVector.normal().times(tanLength);
		point = radialVector.times(baseRadius).plus(tangentialVector);
		points[(2 * resolution) + 2 - i] = point;
	}
	return new CSG.Polygon2D(points);
}

function createBaseCirclePolygon(numTeeth, angularToothWidthAtBase, rootRadius) {
	var points = [];
	var toothAngle = 2 * Math.PI / numTeeth;
	var toothCenterAngle = 0.5 * angularToothWidthAtBase;
	for(var k = 0; k < numTeeth; k++) {
		var currentAngle = toothCenterAngle + k * toothAngle;
		points.push(CSG.Vector2D.fromAngle(currentAngle).times(rootRadius));
	}
	return new CSG.Polygon2D(points);
}

window.jscad.tspi.involuteGear = function(printer, params) {
	knownParameters = [
		{ name: 'teethNumber',			type: 'number',					default: -1				},
		{ name: 'module',				type: 'number',					default: -1				},
		{ name: 'pitchDiameter',		type: 'number',					default: -1				},
		{ name: 'circularToothThickness', type: 'number',					default: -1				},
		{ name: 'pressureAngle',		type: 'number',					default: 20				},
		{ name: 'clearance',			type: 'number',					default: 0				},
		{ name: 'thickness',			type: 'number',					default: -1				},
		{ name: 'centerholeRadius',		type: 'number',					default: 0				},
		{ name: 'resolution',			type: 'number',					default: 5				},
		{ name: 'inclination',			type: 'number',					default: 0				},
		{ name: 'inclinationSteps',		type: 'number',					default: 25				},
		{ name: 'doubleHelical',		type: 'boolean',				default: false			},
	];

	knownPrinterParameters = [
		{ name: 'scale', 						type: 'number', 	default: 1 		},
		{ name: 'correctionInsideDiameter', 	type: 'number', 	default: 0 		},
		{ name: 'correctionOutsideDiameter', 	type: 'number', 	default: 0 		},
		{ name: 'resolutionCircle', 			type: 'number', 	default: 360 	},
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

	this.resolution					= this.parameters['resolution'];
	this.thickness					= this.parameters['thickness'];
	this.inclination				= this.parameters['inclination'];
	this.inclinationSteps			= this.parameters['inclinationSteps'];

	this.pressureAngle				= this.parameters['pressureAngle'];
	this.clearance					= this.parameters['clearance'];
	
	// Calculate module and teethNumber from provided parameters
	var inputModule = this.parameters['module'];
	var inputTeethNumber = this.parameters['teethNumber'];
	var inputPitchDiameter = this.parameters['pitchDiameter'];
	var inputCircularToothThickness = this.parameters['circularToothThickness'];
	
	// Determine module and teethNumber based on which parameters were provided
	if (inputPitchDiameter > 0 && inputTeethNumber > 0) {
		// Method 1: pitchDiameter + teethNumber
		this.teethNumber = inputTeethNumber;
		this.module = inputPitchDiameter / this.teethNumber;
	} else if (inputPitchDiameter > 0 && inputCircularToothThickness > 0) {
		// Method 2: pitchDiameter + circularToothThickness
		// Standard circular tooth thickness at pitch diameter = circularPitch / 2 = module * PI / 2
		this.module = (2 * inputCircularToothThickness) / Math.PI;
		this.teethNumber = Math.round(inputPitchDiameter / this.module);
		// Recalculate module based on rounded teeth number
		this.module = inputPitchDiameter / this.teethNumber;
	} else if (inputModule > 0 && inputPitchDiameter > 0) {
		// Method 3: module + pitchDiameter
		this.module = inputModule;
		this.teethNumber = Math.round(inputPitchDiameter / this.module);
		// Recalculate module based on rounded teeth number
		this.module = inputPitchDiameter / this.teethNumber;
	} else if (inputModule > 0 && inputCircularToothThickness > 0) {
		// Method 4: module + circularToothThickness - need teethNumber
		if (inputTeethNumber > 0) {
			this.module = inputModule;
			this.teethNumber = inputTeethNumber;
		} else {
			// Default to module-based calculation with default teeth
			this.module = inputModule;
			this.teethNumber = 20;
		}
	} else if (inputTeethNumber > 0 && inputCircularToothThickness > 0) {
		// Method 5: teethNumber + circularToothThickness
		this.teethNumber = inputTeethNumber;
		this.module = (2 * inputCircularToothThickness) / Math.PI;
	} else {
		// Default: module + teethNumber (original behavior)
		this.module = inputModule > 0 ? inputModule : 1;
		this.teethNumber = inputTeethNumber > 0 ? inputTeethNumber : 20;
	}
	
	this.circularPitch				= this.module * Math.PI;

	this.centerholeRadius			= this.parameters['centerholeRadius'] + (this.printer['correctionInsideDiameter'] / 2.0);
	this.doubleHelical				= this.parameters['doubleHelical'];

	this.pitchDiameter				= this.teethNumber * this.module;
	this.pitchRadius				= this.pitchDiameter / 2.0;
	this.circularToothThickness		= this.circularPitch / 2.0;
	this.circularToothSpacing		= this.circularPitch;
	this.baseCircleDiameter			= this.pitchDiameter * Math.cos(this.pressureAngle * Math.PI/180.0);
	this.baseCircleRadius			= this.baseCircleDiameter / 2.0;
	this.addendum					= this.module;
	this.dedendum					= this.addendum + this.clearance;
	this.outsideDiameter			= this.pitchDiameter + 2*this.addendum;
	this.outsideRadius				= this.outsideDiameter / 2.0;
	this.rootDiameter				= this.pitchDiameter - 2*this.dedendum;
	this.rootRadius					= this.rootDiameter / 2.0;
	this.initialPhaseOffsetDegrees	= -360 / (4 * this.teethNumber);
	this.initialPhaseOffsetRadians	= this.initialPhaseOffsetDegrees * Math.PI / 180;
	this.initialTangentialOffsetAtPitch	= this.pitchRadius * this.initialPhaseOffsetRadians;

	this.getPitchFeatures = function() {
		return {
			type: 'pitch_circle',
			pitchCircle: {
				center: [0, 0, 0],
				radius: this.pitchRadius,
				diameter: this.pitchDiameter,
				axis: [0, 0, 1]
			},
			module: this.module,
			teethNumber: this.teethNumber,
			pressureAngle: this.pressureAngle,
			circularPitch: this.circularPitch,
			circularToothThickness: this.circularToothThickness,
			source: 'metadata'
		};
	};

	this.getKinematicDefaults = function() {
		return {
			progressName: 'progress',
			progressRange: [0, 1],
			rotationAxis: [0, 0, 1],
			rotationDegreesPerProgress: 360,
			translationAtPitchPerFullTurn: this.teethNumber * this.circularPitch,
			module: this.module,
			teethNumber: this.teethNumber
		};
	};

	this.getPhaseMetadata = function() {
		return {
			kind: 'gear_phase',
			initialToothPhaseOffsetDegrees: this.initialPhaseOffsetDegrees,
			initialToothPhaseOffsetRadians: this.initialPhaseOffsetRadians,
			initialTangentialOffsetAtPitch: this.initialTangentialOffsetAtPitch,
			recommendedRackShiftAtStart: this.circularPitch / 4.0,
			recommendedRackShiftAtStartUnits: 'mm',
			recommendedRackShiftAtStartPitchFraction: 0.25,
			description: 'Gear output is rotated by -360/(4*teeth) so rack-centered animations usually need +circularPitch/4 shift at progress=0.'
		};
	};
	
	this.getModel = function() {
		var maxTangentLength = Math.sqrt(this.outsideRadius*this.outsideRadius - this.baseCircleRadius*this.baseCircleRadius);
		var maxAngle = maxTangentLength / this.baseCircleRadius;

		if(this.doubleHelical) {
			this.thickness = this.thickness/2;
		}
		
		var angle;
		var tangentAtPitchCircle = Math.sqrt(this.pitchRadius*this.pitchRadius - this.baseCircleRadius*this.baseCircleRadius);
		var angleAtPitchCircle = tangentAtPitchCircle / this.baseCircleRadius;
		var angularDifference = angleAtPitchCircle - Math.atan(angleAtPitchCircle);
		var angularToothWidthBase = Math.PI / this.teethNumber + 2 * angularDifference;

		var toothPolygon = createSingleToothPolygon(maxAngle, this.baseCircleRadius, angularToothWidthBase, this.resolution);
		var singleTooth;

		if(this.inclination != 0) {
			var twistAngle = this.thickness * Math.tan(this.inclination * Math.PI/180.0) * 180 / (this.pitchRadius * Math.PI);
			singleTooth = toothPolygon.extrude({ offset: [0, 0, this.thickness], twistangle: twistAngle, twiststeps: this.inclinationSteps});
		} else {
			singleTooth = toothPolygon.extrude({ offset: [0, 0, this.thickness]});
		}

		var teeth = new CSG();
		for(i = 0; i < this.teethNumber; i++) {
			angle = i * 360 / this.teethNumber;
			teeth = teeth.unionForNonIntersecting(singleTooth.rotateZ(angle));
		}

		var rootcircle = createBaseCirclePolygon(this.teethNumber, angularToothWidthBase, this.rootRadius).extrude({offset: [0, 0, this.thickness]});

		var gear = rootcircle.union(teeth);
		var result;
		if(this.centerholeRadius > 0) {
			result = difference(
				gear.translate([0,0,-this.thickness/2.0]),
				cylinder({ r : this.centerholeRadius, h : 3*this.thickness, center: true })
			);
		} else {
			result = gear.translate([0,0,-this.thickness/2.0]);
		}

		if(this.doubleHelical) {
			result = result.translate([0,0, this.thickness/2]);
			result = union(
				result,
				result.mirroredZ()
			);
			this.thickness = this.thickness*2;
		}
		return result;
	};
}

// Convenience functions for different parameter combinations
window.jscad.tspi.involuteGearByModuleTeeth = function(printer, module, teethNumber, pressureAngle, thickness, centerholeRadius) {
	return new window.jscad.tspi.involuteGear(printer, {
		module: module,
		teethNumber: teethNumber,
		pressureAngle: pressureAngle || 20,
		thickness: thickness,
		centerholeRadius: centerholeRadius || 0
	});
};

window.jscad.tspi.involuteGearByPitchDiameterTeeth = function(printer, pitchDiameter, teethNumber, pressureAngle, thickness, centerholeRadius) {
	return new window.jscad.tspi.involuteGear(printer, {
		pitchDiameter: pitchDiameter,
		teethNumber: teethNumber,
		pressureAngle: pressureAngle || 20,
		thickness: thickness,
		centerholeRadius: centerholeRadius || 0
	});
};

window.jscad.tspi.involuteGearByPitchDiameterCircularToothThickness = function(printer, pitchDiameter, circularToothThickness, pressureAngle, thickness, centerholeRadius) {
	return new window.jscad.tspi.involuteGear(printer, {
		pitchDiameter: pitchDiameter,
		circularToothThickness: circularToothThickness,
		pressureAngle: pressureAngle || 20,
		thickness: thickness,
		centerholeRadius: centerholeRadius || 0
	});
};

window.jscad.tspi.involuteGearByModuleCircularToothThickness = function(printer, module, circularToothThickness, teethNumber, pressureAngle, thickness, centerholeRadius) {
	return new window.jscad.tspi.involuteGear(printer, {
		module: module,
		circularToothThickness: circularToothThickness,
		teethNumber: teethNumber,
		pressureAngle: pressureAngle || 20,
		thickness: thickness,
		centerholeRadius: centerholeRadius || 0
	});
};

window.jscad.tspi.gear = function(printer, diameter, thickness, boreDiameter, module, pressureAngle) {
	var gearDiameter = typeof(diameter) === 'number' && diameter > 0 ? diameter : 20;
	var gearThickness = typeof(thickness) === 'number' && thickness > 0 ? thickness : 8;
	var gearBoreDiameter = typeof(boreDiameter) === 'number' && boreDiameter >= 0 ? boreDiameter : 6;
	var gearModule = typeof(module) === 'number' && module > 0 ? module : 1;
	var gearPressureAngle = typeof(pressureAngle) === 'number' && pressureAngle > 0 ? pressureAngle : 20;

	return new window.jscad.tspi.involuteGear(printer, {
		pitchDiameter: gearDiameter,
		module: gearModule,
		pressureAngle: gearPressureAngle,
		thickness: gearThickness,
		centerholeRadius: gearBoreDiameter / 2
	});
};
})();
