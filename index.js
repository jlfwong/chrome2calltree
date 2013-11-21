var fs = require("fs");

var _ = require("lodash");
var _s = require("underscore.string");

// Based on WebInspector.CPUProfileView in CPUProfileView.js in Blink source.
// https://github.com/yoavweiss/Blink/blob/master/Source/devtools/front_end/CPUProfileView.js
var calculateTimes = function(profile) {
    var totalHitCount = function(node) {
        var result = node.hitCount;
        for (var i = 0; i < node.children.length; i++) {
            result += totalHitCount(node.children[i]);
        }
        return result;
    };
    profile.totalHitCount = totalHitCount(profile.head);
    profile.totalTime = 1000 * (profile.endTime - profile.startTime);

    var samplingInterval = profile.totalTime / profile.totalHitCount;

    var calculateTimesForNode = function(node) {
        node.selfTime = node.hitCount * samplingInterval;
        node.selfHitCount = node.hitCount;
        var totalHitCount = node.hitCount;
        for (var i = 0; i < node.children.length; i++) {
            totalHitCount += calculateTimesForNode(node.children[i]);
        }
        node.totalTime = totalHitCount * samplingInterval;
        node.totalHitCount = totalHitCount;
        return totalHitCount;
    };
    calculateTimesForNode(profile.head);
};

var walkTree = function(node, cb) {
    if (!node) {
        return;
    }
    cb(node);
    if (!node.children) {
        return;
    }
    node.children.forEach(function(child) {
        walkTree(child, cb);
    });
};

var chromeProfileToCallgrind = function(profile, outStream) {
    var timedProfile = _.cloneDeep(profile);
    calculateTimes(timedProfile);

    var calls = {};
    walkTree(timedProfile.head, function(node) {
        var call = calls[node.callUID] = calls[node.callUID] || {
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
            node.children.forEach(function(child) {
                var childUID = child.callUID;
                var childCall = childCalls[childUID] = childCalls[childUID] || {
                    functionName: child.functionName,
                    url: child.url,
                    totalHitCount: 0,
                    totalTime: 0,
                    lineNumber: child.lineNumber
                };
                childCall.totalHitCount += child.totalHitCount;
                childCall.totalTime += child.totalTime;
            });
        }
    });

    outStream.write('events: ms hits\n');
    outStream.write(_s.sprintf('summary: %d %d\n',
            timedProfile.totalTime, timedProfile.totalHitCount));

    var fnForCall = function(call) {
        var baseUrl = _.last(_.first(call.url.split("?")).split("/"));
        return _s.sprintf("%s %s:%d",
                call.functionName, baseUrl, call.lineNumber);
    };

    for (var callUID in calls) {
        if (!calls.hasOwnProperty(callUID)) {
            continue;
        }
        var call = calls[callUID];
        outStream.write(_s.sprintf('fl=%s:%d\n', call.url, call.lineNumber));
        outStream.write(_s.sprintf('fn=%s\n', fnForCall(call)));
        outStream.write(_s.sprintf('%d %d %d\n', call.lineNumber,
                call.selfTime, call.selfHitCount));
        for (var childCallUID in call.childCalls) {
            if (!call.childCalls.hasOwnProperty(childCallUID)) {
                continue;
            }
            var childCall = call.childCalls[childCallUID];
            outStream.write(_s.sprintf('cfi=%s:%d\n',
                    childCall.url, childCall.lineNumber));
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
