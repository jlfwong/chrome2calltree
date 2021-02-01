var fs = require("fs");

var _ = require("lodash");
var _s = require("underscore.string");

var findNodeById = function(nodes, id) {
    return nodes.find(node => node.id == id);
}

// Based on WebInspector.CPUProfileView in CPUProfileView.js in Blink source.
// https://github.com/yoavweiss/Blink/blob/master/Source/devtools/front_end/CPUProfileView.js
var totalHitCount = function(nodes, node) {
    var result = node.hitCount;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            result += totalHitCount(nodes, findNodeById(nodes, node.children[i]));
        }    
    }
    return result;
};

var calculateTimesForNode = function(nodes, node, samplingInterval) {
    node.selfTime = node.hitCount * samplingInterval;
    node.selfHitCount = node.hitCount;
    var totalHitCount = node.hitCount;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            totalHitCount += calculateTimesForNode(nodes, findNodeById(nodes, node.children[i]), samplingInterval);
        }    
    }
    node.totalTime = totalHitCount * samplingInterval;
    node.totalHitCount = totalHitCount;
    return totalHitCount;
};

var calculateTimes = function(profile) {    
    profile.totalHitCount = totalHitCount(profile.nodes, profile.nodes[0]);
    profile.totalTime = 1000 * (profile.endTime - profile.startTime);
    var samplingInterval = profile.totalTime / profile.totalHitCount;

    calculateTimesForNode(profile.nodes, profile.nodes[0], samplingInterval);
};

var fnForCall = function(call) {
    var baseUrl = _.last(_.first(call.url.split("?")).split("/"));
    if (call.lineNumber < 0) {
        // kcachegrind complains about negative line numbers
        return _s.sprintf("%s %s",
                call.functionName, baseUrl);
    } else {
        return _s.sprintf("%s %s:%d",
                call.functionName, baseUrl, call.lineNumber);
    }
};

var chromeProfileToCallgrind = function(profile, outStream, copy) {
    if (typeof copy === 'undefined') {
	copy = true;
    }
    var timedProfile = copy ? _.cloneDeep(profile) : profile;

    calculateTimes(timedProfile);

    var calls = {};

    var allNodes = profile.nodes;

    // declare iterator vars used in two different blocks
    var i, j, call, childCall; 
    for (i = 0; i < allNodes.length; i++) {
        var node = allNodes[i];

        call = calls[node.id] = calls[node.id] || {
            functionName: node.callFrame.functionName,
            url: node.callFrame.url,
            selfTime: 0,
            selfHitCount: 0,
            lineNumber: node.callFrame.lineNumber,
            childCalls: {}
        };
        call.selfHitCount += node.selfHitCount;
        call.selfTime += node.selfTime;

        var childCalls = call.childCalls;
        if (node.children) {
            for(j = 0; j < node.children.length; j++) {
                var child = findNodeById(allNodes, node.children[j]);

                var childUID = child.id;
                childCall = childCalls[childUID] = childCalls[childUID] || {
                    functionName: child.callFrame.functionName,
                    url: child.callFrame.url,
                    totalHitCount: 0,
                    totalTime: 0,
                    lineNumber: child.callFrame.lineNumber
                };
                childCall.totalHitCount += child.totalHitCount;
                childCall.totalTime += child.totalTime;
            }
        }
    }

    outStream.write('events: ms hits\n');
    outStream.write(_s.sprintf('summary: %d %d\n',
            timedProfile.totalTime, timedProfile.totalHitCount));


    // by using Object.keys, we can skip the
    // hasOwnProperty check
    var callUIDArray = Object.keys(calls);
    for (i = 0; i < callUIDArray.length; i++) {
        call = calls[callUIDArray[i]];

        outStream.write(_s.sprintf('fl=%s\n', call.url));
        outStream.write(_s.sprintf('fn=%s\n', fnForCall(call)));
        outStream.write(_s.sprintf('%d %d %d\n', Math.max(0, call.lineNumber),
                call.selfTime, call.selfHitCount));

        var childCallUIDArray = Object.keys(call.childCalls);
        for (j = 0; j < childCallUIDArray.length; j++) {
            childCall = call.childCalls[childCallUIDArray[j]];

            outStream.write(_s.sprintf('cfi=%s\n', childCall.url));
            outStream.write(_s.sprintf('cfn=%s\n', fnForCall(childCall)));

            outStream.write(_s.sprintf('calls=0 %d\n', Math.max(0, childCall.lineNumber)));
            outStream.write(_s.sprintf('%d %d %d\n',
                    Math.max(0, call.lineNumber), childCall.totalTime,
                    childCall.totalHitCount));
        }
        outStream.write('\n');
    }
};

module.exports = {
    chromeProfileToCallgrind: chromeProfileToCallgrind
};
