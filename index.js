var fs = require("fs");

var _ = require("lodash");
var _s = require("underscore.string");

// Based on WebInspector.CPUProfileView in CPUProfileView.js in Blink source.
// https://github.com/yoavweiss/Blink/blob/master/Source/devtools/front_end/CPUProfileView.js
var totalHitCount = function(node) {
    var result = node.hitCount;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            result += totalHitCount(node.children[i]);
        }    
    }
    return result;
};

var calculateTimesForNode = function(node, samplingInterval) {
    node.selfTime = node.hitCount * samplingInterval;
    node.selfHitCount = node.hitCount;
    var totalHitCount = node.hitCount;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            totalHitCount += calculateTimesForNode(node.children[i], samplingInterval);
        }    
    }
    node.totalTime = totalHitCount * samplingInterval;
    node.totalHitCount = totalHitCount;
    return totalHitCount;
};

var calculateTimes = function(profile) {    
    profile.totalHitCount = totalHitCount(profile.head);
    profile.totalTime = 1000 * (profile.endTime - profile.startTime);
    var samplingInterval = profile.totalTime / profile.totalHitCount;

    calculateTimesForNode(profile.head, samplingInterval);
};

var treeToArrayAcc = function(node, acc) {
    acc.push(node);
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            acc = acc.concat(treeToArrayAcc(node.children[i], []));
        }
    }
    return acc;
};

var treeToArray = function(node) {
    return treeToArrayAcc(node, []);
};

var fnForCall = function(call) {
    var baseUrl = _.last(_.first(call.url.split("?")).split("/"));
    return _s.sprintf("%s %s:%d",
            call.functionName, baseUrl, call.lineNumber);
};

var chromeProfileToCallgrind = function(profile, outStream, copy) {
    var timedProfile = copy ? _.cloneDeep(profile) : profile;

    calculateTimes(timedProfile);

    var calls = {};

    var allNodes = treeToArray(timedProfile.head);

    // declare iterator vars used in two different blocks
    var i, j, call, childCall; 
    for (i = 0; i < allNodes.length; i++) {
        var node = allNodes[i];

        call = calls[node.callUID] = calls[node.callUID] || {
            functionName: node.functionName,
            url: node.url,
            selfTime: 0,
            selfHitCount: 0,
            lineNumber: node.lineNumber,
            childCalls: {}
        };
        call.selfHitCount += node.selfHitCount;
        call.selfTime += node.selfTime;

        var childCalls = call.childCalls;
        if (node.children) {
            for(j = 0; j < node.children.length; j++) {
                var child = node.children[j];

                var childUID = child.callUID;
                childCall = childCalls[childUID] = childCalls[childUID] || {
                    functionName: child.functionName,
                    url: child.url,
                    totalHitCount: 0,
                    totalTime: 0,
                    lineNumber: child.lineNumber
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
        outStream.write(_s.sprintf('%d %d %d\n', call.lineNumber,
                call.selfTime, call.selfHitCount));

        var childCallUIDArray = Object.keys(call.childCalls);
        for (j = 0; j < childCallUIDArray.length; j++) {
            childCall = call.childCalls[childCallUIDArray[j]];

            outStream.write(_s.sprintf('cfi=%s\n', childCall.url));
            outStream.write(_s.sprintf('cfn=%s\n', fnForCall(childCall)));

            outStream.write(_s.sprintf('calls=0 %d\n', childCall.lineNumber));
            outStream.write(_s.sprintf('%d %d %d\n',
                    call.lineNumber, childCall.totalTime,
                    childCall.totalHitCount));
        }
        outStream.write('\n');
    }
};

module.exports = {
    chromeProfileToCallgrind: chromeProfileToCallgrind
};
