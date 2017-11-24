/*******************************************************************************
 * Copyright (c) 2017 Eurotech and/or its affiliates and others
 * 
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0 which
 * accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 * 
 ******************************************************************************/

joint.shapes.customLink = {};
joint.shapes.customLink.Element = joint.dia.Link.extend({
		defaults : joint.util.deepSupplement({
			type : 'customLink.Element',
			router : {
				name : 'metro',
				args : {
					startDirections : [ 'right' ],
					endDirections : [ 'left' ]
				}
			},
			connector : {
				name : 'rounded'
				},
			attrs : {
				'.connection' : {
					'stroke' : "#4b4f6a",
					'stroke-width' : 4
				},
				'.marker-target' : {
					d : 'M 10 0 L 0 5 L 10 10 z'
				},
			},
		}, joint.dia.Link.prototype.defaults)
	});

var WireComposer = function (element) {
	
	var self = this
	
	this.currentZoomLevel = 1;
	this.transitionRunning = false;
	this.selectedComponent = null;
	
	this.graph = new joint.dia.Graph;
	this.element = element;
	this.blinkEnabled = true

	this.graph.on('change:source change:target', function(link) {
		if (typeof link.attributes.source.id == 'undefined'
				|| typeof link.attributes.target.id == 'undefined') {
			return 
		}
		var sourceCell = self.graph.getCell(link.attributes.source.id)
		var targetCell = self.graph.getCell(link.attributes.target.id)
		var wire = {
			emitterPort: 0,
			receiverPort: 0,
			emitterPid: sourceCell.attributes.wireComponent.pid,
			receiverPid: targetCell.attributes.wireComponent.pid
		}
		link.attributes.wire = wire
		if (!link.attributes.wire) {
			console.log('wire created:')
			console.log(wire)
			self.dispatchWireCreated(wire)
		} else {
			console.log('wire changed:')
			console.log(wire)
			self.dispatchWireChanged(wire)
		}
	});
	
	this.graph.on('remove', function (cell) {
		if (cell.attributes.wireComponent) {
			console.log('wire component deleted:')
			console.log(cell.attributes.wireComponent)
			self.dispatchWireComponentDeleted(cell.attributes.wireComponent)
		} else if (cell.attributes.wire) {
			console.log('wire deleted:')
			console.log(cell.attributes.wire)
			self.dispatchWireDeleted(cell.attributes.wire)
		}
	})

	this.paper = new joint.dia.Paper({
		el : $(element),
		width : '100%',
		height : '100%',
		gridSize : 20,
		snapLinks : true,
		linkPinning : false,
		defaultLink : new joint.shapes.customLink.Element,
		multiLinks : false,
		markAvailable : true,
		model: this.graph,
		interactive : {
			vertexAdd : false
		},
		validateConnection : function(cellViewS, magnetS, cellViewT,
				magnetT, end, linkView) {
			// Prevent linking from input ports.
			if (magnetS && magnetS.getAttribute('type') === 'input')
				return false;
			// Prevent linking from output ports to input ports within
			// one element.
			if (cellViewS === cellViewT)
				return false;
			// Prevent linking to input ports.
			if (magnetT && magnetT.getAttribute('type') !== 'input') {
				return false;
			}
			
			if (cellViewS && cellViewT && self.hasCycles(cellViewT.model, [ cellViewS.model.id ])) {
				return false;
			}
			
			return true
		}
	});

	this.paper.on('cell:pointerup', function(cellView, evt, x, y) {
		var component = cellView.model.attributes.wireComponent
		if (component == null) {
			return
		}
		if (self.selectedComponent != component) {
			if (self.selectedComponent) {
				self.dispatchWireComponentDeselected(self.selectedComponent)
			}
			self.selectedComponent = component
			self.fillRenderingProperties(cellView.model)
			self.dispatchWireComponentSelected(component)
		}
	});
	
	this.paper.on('blank:pointerdown', function(cellView, evt, x, y) {
		self.disableBlinking()
		self.scroller.begin()
		if (self.selectedComponent) {
			self.dispatchWireComponentDeselected(self.selectedComponent)
			self.selectedComponent = null
		}
	});

	this.paper.$el.on('contextmenu', function(evt) {
		evt.stopPropagation();
		evt.preventDefault();
	});
	
	this.viewport = V(this.paper.viewport)
	
	this.transform = this.transform.bind(this)
	this.transformTransition = this.transformTransition.bind(this)
	
	this.scroller = new Scroller()
	this.scroller.onMove(function (dx, dy) {
		self.viewport.translate(dx, dy)
	})
	this.scroller.onEnd = function() {
		self.enableBlinking()
	}
	
	this.dragHandler = new DragHandler(this)
}

WireComposer.prototype.addWireComponent = function (component) {
	var self = this
	var position = component.renderingProperties.position
	
	if (!position) {
		position = this.getNewComponentCoords()
		component.renderingProperties.position = position
	}
	
	var componentCell = new joint.shapes.devs.Atomic({
		position : position,
		attrs : {
			'.label' : {
				text : joint.util.breakText(component.pid, {
					width : 100
				}),
			},
			'.body' : {
				'rx' : 6,
				'ry' : 6
			}
		},
		inPorts : component.inputPortCount > 0 ? [""] : [],
		outPorts : component.outputPortCount > 0 ? [""] : [],
		wireComponent: component
	})

	componentCell.on('change:position', function(cellView) {
		self.fillRenderingProperties(cellView)
		self.dispatchWireComponentChanged(component)
	})
	
	if (this.moveToFreeSpot(componentCell)) {
		this.centerOnComponent(componentCell)
	}
	
	this.graph.addCells([ componentCell ])
	this.dispatchWireComponentCreated(component)
}

WireComposer.prototype.getSelectedWireComponent = function () {
	return this.selectedComponent
}

WireComposer.prototype.deleteWireComponent = function (component) {
	var elements = this.graph.getElements() 
	for (var i = 0; i < elements.length; i++) {
		var element = elements[i];
		if (element.attributes.wireComponent.pid === component.pid) {
			element.remove()
		}
	}
}

WireComposer.prototype.clear = function () {
	this.graph.clear()
}

WireComposer.prototype.addWire = function (wire) {
	var _elements = this.graph.getElements();
	var emitter = null, receiver = null;
	for (var i = 0; i < _elements.length; i++) {
		var element = _elements[i];
		if (element.attributes.wireComponent.pid === wire.emitterPid) {
			emitter = element;
		}
		if (element.attributes.wireComponent.pid === wire.receiverPid) {
			receiver = element;
		}
	}
	if (emitter != null && receiver != null) {
		var link = new joint.shapes.customLink.Element({
			source : {
				id : emitter.id
			},
			target : {
				id : receiver.id
			},
			wire: wire
		});
		this.graph.addCell(link);
	}
}

WireComposer.prototype.forEachWireComponent = function (callback) {
	var elements = this.graph.getElements() 
	for (var i = 0; i < elements.length; i++) {
		var element = elements[i];
		if (element.attributes.wireComponent) {
			this.fillRenderingProperties(element)
			callback(element.attributes.wireComponent)
		}
	}
}

WireComposer.prototype.forEachWire = function (callback) {
	var elements = this.graph.getLinks() 
	for (var i = 0; i < elements.length; i++) {
		var element = elements[i];
		if (element.attributes.wire) {
			callback(element.attributes.wire)
		}
	}
}

WireComposer.prototype.getWireComponentCount = function () {
	var count = 0
	this.forEachWireComponent(function () {
		count++
	})
	return count
}

WireComposer.prototype.getWireCount = function () {
	var count = 0
	this.forEachWire(function () {
		count++
	})
	return count
}

WireComposer.prototype.fitContent = function (transition) {
	var bbox = this.getLocalContentBBox()
	var cx = bbox.x + bbox.width/2
	var cy = bbox.y + bbox.height/2
	var vw = $('#wires-graph').width()
	var vh = $('#wires-graph').height()
	var factor = Math.min(vw/bbox.width, vh/bbox.height)
	if (factor > 1) {
		factor = 1
	}
	this.centerOnLocalPoint(cx, cy, factor, transition ? this.transformTransition : this.transform, 0.5)
}

WireComposer.prototype.zoomIn = function () {
	this.scale(1.2)
}

WireComposer.prototype.zoomOut = function () {
	this.scale(0.8)
}

WireComposer.prototype.checkForCycleExistence = function () {
	var visited = [];
	var isCycleExists;
	var _elements = this.graph.getElements();
	for (var i = 0; i < _elements.length; i++) {
		var elem = _elements[i];
		if ((this.graph.getPredecessors(elem).length == 0)
				&& this.hasCycles(elem, visited)) {
			isCycleExists = true;
			break;
		}
	}
	return isCycleExists;
}

WireComposer.prototype.hasCycles = function (element, visited) {
	var neighbors = this.graph.getNeighbors(element, {
		outbound : true
	}), i;

	if (visited.indexOf(element.id) > -1)
		return true;

	visited.push(element.id);

	for (i = 0; i < neighbors.length; i++)
		if (this.hasCycles(neighbors[i], visited.slice()))
			return true;

	return false;
}

WireComposer.prototype.scale = function(factor) {
	var translation = this.viewport.translate()
	var cx = $(this.element).width()/2
	var cy = $(this.element).height()/2
	var tx = cx*(1-factor)+translation.tx*factor
	var ty = cy*(1-factor)+translation.ty*factor
	this.transformTransition(tx, ty, this.currentZoomLevel*factor, 0.25)
}

WireComposer.prototype.clientToLocal = function (clientX, clientY) {
	var translation = this.viewport.translate()
	var x = (clientX-translation.tx)/this.currentZoomLevel
	var y = (clientY-translation.ty)/this.currentZoomLevel
	return {x: x, y: y}
}

WireComposer.prototype.moveToFreeSpot = function(comp) {
	var moved = false
	while (this.graph.findModelsUnderElement(comp).length) {
		moved = true
		comp.translate(100, 0)
	}
	return moved
}

WireComposer.prototype.centerOnComponent = function(comp) {
	var pos = comp.get('position')
	var scale = this.currentZoomLevel < 1 ? 1 : this.currentZoomLevel
	this.centerOnLocalPoint(pos.x, pos.y, scale, this.transformTransition)
}

WireComposer.prototype.getNewComponentCoords = function () {
	var cx = $(this.element).width() / 2
	var cy = $(this.element).height() / 2
	return this.clampToGrid(this.clientToLocal(cx, cy))
}

WireComposer.prototype.clampToGrid = function (pos) {
	var gridSize = this.paper.options.gridSize
	pos.x = Math.floor(pos.x/gridSize)*gridSize
	pos.y = Math.floor(pos.y/gridSize)*gridSize
	return pos
}

WireComposer.prototype.transformTransition = function (translationx, translationy, scale, durationSeconds) {
	if (this.transitionRunning) {
		return
	}
	this.transitionRunning = true
	var initialTranslation = this.viewport.translate()
	var initialScale = this.currentZoomLevel
	var start = null
	this.disableBlinking()
	var self = this
	var step = function (timestamp) {
		start = start || timestamp
		var alpha = Math.min((timestamp-start)/durationSeconds/1000, 1)
		var calpha = 1-alpha
		var translationX = initialTranslation.tx*calpha+translationx*alpha
		var translationY = initialTranslation.ty*calpha+translationy*alpha
		var currentScale = initialScale*calpha+scale*alpha
		self.transform(translationX, translationY, currentScale)
		if (alpha < 1) {
			window.requestAnimationFrame(step)
		} else {
			self.transitionRunning = false
			self.enableBlinking()
		}
	}
	window.requestAnimationFrame(step)
}

WireComposer.prototype.transform = function (translationX, translationY, scale) {
	this.viewport.translate(translationX, translationY, {absolute: true})
	this.viewport.scale(scale)
	this.currentZoomLevel = scale
}

WireComposer.prototype.getLocalContentBBox = function () {
	var bbox = this.paper.getContentBBox() // this is in client coordinates
	var tl = this.clientToLocal(bbox.x, bbox.y)
	var br = this.clientToLocal(bbox.x + bbox.width, bbox.y + bbox.height)
	return { x: tl.x, y: tl.y, width: br.x-tl.x, height: br.y-tl.y }
}

WireComposer.prototype.centerOnLocalPoint = function (cx, cy, scale, transformFunc, transitionSpeed) {
	var transitionSpeed = transitionSpeed || 0.5
	var vw = $(this.element).width()
	var vh = $(this.element).height()
	transformFunc(vw/2-scale*cx, vh/2-scale*cy, scale, transitionSpeed)
}

WireComposer.prototype.disableBlinking = function () {
	this.blinkEnabled = false
	var self = this
	if (this.blinkEnableTimeout) {
		clearTimeout(self.blinkEnableTimeout)
		self.blinkEnableTimeout = null
	}
}

WireComposer.prototype.enableBlinking = function () {
	var self = this
	if (!this.blinkEnabled && !this.blinkEnableTimeout) {
		this.blinkEnableTimeout = setTimeout(function () {
			self.blinkEnabled = true
			self.blinkEnableTimeout = null
		}, 1000)
	} 
}

WireComposer.prototype.setListener = function (listener) {
	this.listener = listener
}

WireComposer.prototype.fillRenderingProperties = function (componentCell) {
	componentCell.attributes.wireComponent.renderingProperties.position = componentCell.attributes.position
}

var Scroller = function () {
	this.last = null;
	this.onMouseMove = this.onMouseMove.bind(this)
	this.onMouseUp = this.onMouseUp.bind(this)
	this.callback = function() {}
	this.onEnd = function() {}
}

Scroller.prototype.onMouseMove = function (e) {
	var x = e.clientX
	var y = e.clientY
	if (!this.last) {
		this.last = {x: x, y: y}
		return
	}
	var dx = x - this.last.x;
	var dy = y - this.last.y;
	
	this.last.x = x
	this.last.y = y
	
	if (this.callback) {
		this.callback(dx, dy)
	}
}

Scroller.prototype.onMouseUp = function () {
	document.removeEventListener('mousemove', this.onMouseMove)
	document.removeEventListener('mouseup', this.onMouseUp)
	this.last = null
	this.onEnd()
}

Scroller.prototype.begin = function () {
	document.addEventListener('mousemove', this.onMouseMove)
	document.addEventListener('mouseup', this.onMouseUp)
}

Scroller.prototype.onMove = function (callback) {
	this.callback = callback
}

var DragHandler = function (composer) {
	this.dndHelper = DropSupport.addIfSupported(composer.element)
	this.composer = composer
	var self = this
	if (this.dndHelper) {
		this.dndHelper.dragOverHandler = function (event) {
			self.movePreview(event.clientX, event.clientY)
			return true
		}
		this.dndHelper.dragExitHandler = function (event) {
			self.abort()
		}
		this.dndHelper.dropHandler = function(event) { 
			self.onDrop(event.dataTransfer.getData('text'), event.clientX, event.clientY)
			return true
		}
	}
}


DragHandler.prototype.toLocalCoords = function (clientX, clientY) {
	var offset = $(this.composer.element).offset()
	clientX -= offset.left - $(window).scrollLeft()
	clientY -= offset.top - $(window).scrollTop()
	return this.composer.clampToGrid(this.composer.clientToLocal(clientX, clientY))
}

DragHandler.prototype.movePreview = function (clientX, clientY) {
	if (this.rect == null) {
		this.initTempElement()
	}
	var pos = this.toLocalCoords(clientX, clientY)
	var oldPos = this.rect.position()
	if (pos.x != oldPos.x || pos.y != oldPos.y) {
		this.rect.position(pos.x, pos.y)
	}
}

DragHandler.prototype.onDrop = function (attachment, clientX, clientY) {
	var self = this
	var event = {
		getAttachment: function () {
			return attachment
		},
		complete: function (component) {
			var pos = self.toLocalCoords(clientX, clientY)
			component.renderingProperties.position = pos
			self.abort()
			self.composer.addWireComponent(component)
		},
		cancel: function () {
			self.abort()
		}
	}
	self.composer.dispatchDrop(event)
}

DragHandler.prototype.abort = function () {
	if (this.rect) {
		this.composer.graph.removeCells([ this.rect ])
		this.rect = null
	}
}

DragHandler.prototype.initTempElement = function () {
	this.rect = new joint.shapes.devs.Atomic({
		position : {
			x : 0,
			y : 0
		}
	});

	this.composer.graph.addCells([ this.rect ]);
	
	this.rect.attr({
		'.label' : {
			text : "",
		},
		'.body' : {
			'rx' : 6,
			'ry' : 6,
			'class': 'body temporary'
		}
	});
}
