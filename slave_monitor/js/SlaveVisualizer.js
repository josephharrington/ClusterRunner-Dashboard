
var conf = require('./conf.js');
var Log = require('./Log.js');
var Visualizer = require('./Visualizer.js');


var errorLightImage = 'themes/christmas/red_light.gif';
var inactiveLightImage = 'themes/christmas/grey_light_noblink.gif';
var lightImagesByColor = {
    'green': 'themes/christmas/green_light.gif',
    'blue': 'themes/christmas/blue_light.gif',
    'purple': 'themes/christmas/purple_light.gif',
    'yellow': 'themes/christmas/yellow_light.gif'
};

function randomColor() {
    var lightColors = Object.keys(lightImagesByColor);
    return lightColors[Math.floor(lightColors.length * Math.random())];
}


function SlaveVisualizer(slaveDatasource, healthCheckDatasource, buildVisualizer, hostAbbrevRegex)
{
    this._slaveDatasource = slaveDatasource;
    this._buildVisualizer = buildVisualizer;
    this._healthCheckDatasource = healthCheckDatasource;
    this._hostAbbrevRegex = hostAbbrevRegex;

    this._slaveGraphicGroups = null;
    //this._slaveLabels = null;

    this._force = null;
    this._width = null;
    this._height = null;
}
SlaveVisualizer.prototype = new Visualizer();
SlaveVisualizer.prototype.constructor = SlaveVisualizer;
var cls = SlaveVisualizer.prototype;

cls.init = function(g, force, width, height)
{
    this._slaveGraphicGroups = g.selectAll('.slaveCircle');
    //this._slaveLabels = g.selectAll('.slaveLabel');
    this._slaveToBuildLinks = g.selectAll('.slaveToBuildLinks');

    this._force = force;
    this._width = width;
    this._height = height;
};

cls.update = function()
{
    // Note: We have to persist the same node objects in between updates (instead of recreating them on each update).
    // The reason is that the force directed graph stores position data on the existing objects, and the physics tick
    // occurs more frequently than this update method is called. If we replace a node object with a new one, even if
    // they have the exact same creation properties, they will not have the same positioning data.
    Log.info('SlaveVisualizer.update()');
    var graphStateChanged = false;

    // Use the buildVisualizer to create a map from buildId to build graph node
    var currentBuildNodesById = {};
    this._buildVisualizer.getNodes().map(function(buildNode) {
        currentBuildNodesById[buildNode.buildId.toString()] = buildNode;
    });

    // generate a map of slaveId to graphNode // todo: can we cache this and not generate every time? if so, how do we remove elements (or does it matter)?
    var graphNodesBySlaveId = {};
    for (var i = 0, iMax = this._graphNodes.length; i < iMax; i++) {
        graphNodesBySlaveId[this._graphNodes[i].slaveDatum.id] = this._graphNodes[i];
    }

    // create a list of old slave ids and new slave ids, then compare them.
    var oldSlaveIds = Object.keys(graphNodesBySlaveId).sort();
    var newSlaveIds = Object.keys(this._slaveDatasource.data).sort();
    // if the lists are different at all, that means slaves were added or removed.
    graphStateChanged = !this.areArraysSame(oldSlaveIds, newSlaveIds) || graphStateChanged;

    var _this = this;
    var updatedGraphNodesList = [];

    for (var i = 0, l = newSlaveIds.length; i < l; i++) {
        var slaveId = newSlaveIds[i];
        var slaveDatum = this._slaveDatasource.data[slaveId];
        var attractToNode = currentBuildNodesById[slaveDatum.current_build_id] || currentBuildNodesById['IDLE'];  // may be undefined
        var graphNode;

        if (slaveId in graphNodesBySlaveId) {
            // if we already have a node for this slaveId, just update that object instead of replacing it (the object has extra positioning data that we want to preserve)
            graphNode = graphNodesBySlaveId[slaveId];
            if (graphNode.attractToNode !== attractToNode) {
                graphNode.attractToNode = attractToNode;
                graphStateChanged = true;
            }
            graphNode.slaveDatum = slaveDatum;

        } else {
            // otherwise this is a new node
            graphNode = {
                type: 'slave',
                slaveDatum: slaveDatum,
                lightColor: randomColor(),
                size: conf.slaveCircleSize,
                classes: function() {  // todo: should this just go down in the svg part where classes() is called?
                    var extraClasses = '';
                    var slaveIsBusy = (this.slaveDatum.current_build_id || this.slaveDatum.num_executors_in_use > 0);
                    var slaveIsUnresponsive = _this._healthCheckDatasource.data[this.slaveDatum.id] === false;
                    var slaveIsResponsive = _this._healthCheckDatasource.data[this.slaveDatum.id] === true;
                    var slaveIsMarkedDead = this.slaveDatum.is_alive === false;

                    if (slaveIsResponsive) {
                        extraClasses += 'responsive ';
                    }
                    else if (slaveIsUnresponsive) {
                        extraClasses += 'unresponsive ';
                    }

                    if (slaveIsMarkedDead) {
                        extraClasses += 'dead ';
                    }
                    else if (slaveIsBusy) {
                        extraClasses += 'busy ';
                    }
                    else {
                        extraClasses += 'idle ';
                    }

                    return 'slaveGraphicGroup ' + extraClasses;
                },
                wallRepelForce: conf.slaveWallRepelForce,
                link: null,
                attractToNode: attractToNode
            };
        }
        updatedGraphNodesList.push(graphNode);
    }

    this._graphNodes = updatedGraphNodesList;

    // update links on graphNodes
    // todo: update links directly instead of updating attractToNode?
    var graphLinks = [];
    this._graphNodes.map(function(graphNode) {
        // create new links if needed
        if (graphNode.attractToNode && !graphNode.link) {
            graphNode.link = {source: graphNode};
        }
        // update all link targets
        if (graphNode.link) {
            graphNode.link.target = graphNode.attractToNode;  // may be setting to null
        }
        // remove dead links
        if (graphNode.link && !graphNode.link.target) {
            graphNode.link = null;
        }
        // aggregate current links
        if (graphNode.link) {
            graphNode.link.linkLength = graphNode.link.target.linkLength;
            graphNode.link.linkStrength = graphNode.link.target.linkStrength;
            graphLinks.push(graphNode.link);
        }
    });
    this._graphLinks = graphLinks;

    this._updateSvgElements();
    return graphStateChanged;
};

cls._updateSvgElements = function()
{
    this._slaveGraphicGroups = this._slaveGraphicGroups.data(this._graphNodes, function(d) {return d.slaveDatum['url']});

    // Create
    var enterSelection = this._slaveGraphicGroups.enter()
        .insert('g')
        .attr('class', 'slaveGraphicGroup')
        .call(this._force.drag);

    //enterSelection
    //    .append('circle')
    //    .attr('r', function(d) { return d.size; });

    var imgScaleFactor = 1;
    var imgW = 46;
    var imgH = 31;
    enterSelection
        .append('svg:image')
        .attr('class', 'slaveImage')
        //.attr('xlink:href', function(d) {return lightImagesByColor[d.lightColor]})
        .attr('x', -imgScaleFactor * imgW / 2)
        .attr('y', -imgScaleFactor * imgH / 2)
        .attr('width', imgScaleFactor * imgW)
        .attr('height', imgScaleFactor * imgH)
        .attr('transform', function() {return 'rotate(' + Math.random() * 360 + ')'});

    var hostAbbrevRegex = this._hostAbbrevRegex;
    var slaveLabels = enterSelection
        .append('text')
        .attr('class', 'slaveLabel')
        .attr('x', 0)
        .attr('y', function(d) { return d.size + 9; })
        .text(function(d) {
            var slaveUrl = d.slaveDatum['url'];

            // generate an abbreviated hostname from the dashboard.ini conf value
            var matches = (new RegExp(hostAbbrevRegex, 'g')).exec(slaveUrl);
            if (matches && matches.length > 1) {
                return matches[1];
            }

            // if no conf value specified, extract the last numerical sequence before the port number (if any)
            matches = /(\d+)[\D]*:\d+$/.exec(slaveUrl);
            if (matches && matches.length > 1) {
                return matches[1];
            }

            // if still no match, just abbreviate the hostname
            return slaveUrl.substring(0, 7) + '...';
        });

    // Destroy
    this._slaveGraphicGroups.exit()
        .remove();

    // Update
    this._slaveGraphicGroups
        .attr('class', function(d) { return d.classes(); });

    this._slaveGraphicGroups
        .selectAll('.slaveImage')
        .attr('xlink:href', function(d) {
            var containingGroup = d3.select(this.parentNode);
            if (containingGroup.classed('unresponsive') || containingGroup.classed('dead')) {
                return errorLightImage;
            }
            if (containingGroup.classed('idle')) {
                return inactiveLightImage;
            }
            return lightImagesByColor[d.lightColor]
        });

    if (conf.features.drawSlaveLinks) {
        this._slaveToBuildLinks = this._slaveToBuildLinks.data(this._graphLinks, function(d) {return d.source.slaveDatum['url']});
        this._slaveToBuildLinks.enter().append('line')
            .attr('class', 'slaveLink');
        this._slaveToBuildLinks.exit().remove();
    } else {
        this._slaveToBuildLinks = this._slaveToBuildLinks.data([]);
        this._slaveToBuildLinks.exit().remove();
    }
};

var counter = 0;
/**
 * Update the positions of SVG elements managed by this visualizer.
 * @param e
 */
cls.tick = function(e)
{
    // partition slave nodes into groups based on build
    var slaveGroupsByBuild = {};
    for (var i = 0, l = this._graphLinks.length; i < l; i++) {
        var link = this._graphLinks[i];
        var buildNode = link.target;
        if (!(buildNode.buildId in slaveGroupsByBuild)) {
            slaveGroupsByBuild[buildNode.buildId] = [];
        }
        slaveGroupsByBuild[buildNode.buildId].push(link.source);
    }

    // make all slave nodes for each build repel each other
    var slaveRepelForce = conf.buildSlaveRepelForce * e.alpha;
    Object.keys(slaveGroupsByBuild).forEach(function(buildId) {
        var slaves = slaveGroupsByBuild[buildId];
        slaves.map(function(slaveNodeA) {
            slaves.map(function(slaveNodeB) {
                if (slaveNodeA == slaveNodeB) return;

                var dx = slaveNodeB.x - slaveNodeA.x;
                var dy = slaveNodeB.y - slaveNodeA.y;
                var dxSq = Math.pow(dx, 2);
                var dySq = Math.pow(dy, 2);
                var dSq = dxSq + dySq;

                var d = Math.sqrt(dSq);
                var f = slaveRepelForce / dSq;

                slaveNodeA.x -= dx * f / d;
                slaveNodeA.y -= dy * f / d;
            })});
    });

    //// update positions of svg circles
    //this._slaveGraphicGroups
    //    .attr('cx', function(d) { return d.x; })
    //    .attr('cy', function(d) { return d.y; });

    // update positions of build graphics
    this._slaveGraphicGroups
        .attr('transform', function(d) {return 'translate(' + d.x + ', ' + d.y + ')'});

    // update positions of text labels
    //this._slaveLabels
    //    .attr('text-anchor', 'middle')
    //    .attr('x', function(d) { return d.x; })
    //    .attr('y', function(d) { return d.y + d.size + 9; });

    if (conf.features.drawSlaveLinks) {
        // update positions of svg lines
        this._slaveToBuildLinks
            .attr('x1', function(d) { return d.source.x; })
            .attr('x1', function(d) { return d.source.x; })
            .attr('y1', function(d) { return d.source.y; })
            .attr('x2', function(d) { return d.target.x; })
            .attr('y2', function(d) { return d.target.y; });
    }

};


module.exports = SlaveVisualizer;
