"use strict";

var express = require('express');
var bodyParser = require('body-parser');
var _ = require("underscore");

var app = express();

app.use(bodyParser());
app.use(express.static(__dirname + "/public"));
app.use(function(err, req, res, next) {
    console.log(err.stack);
    res.send(500, 'Server error');
    next(err);
});

var db = {
    proposal: {
        5: {
            title: "Some proposal",
            description: "Hello",
            points: [1,2]
        },
        6: {
            title: "Other proposal",
            description: "Moo",
            points: [3,4,5,6]
        }
    },
    point: {
        1: {
            text: "This sucks.",
            isPro: false
        },
        2: {
            text: "This is good.",
            isPro: true
        },
        3: {
            text: "I like it.",
            isPro: true
        },
        4: {
            text: "I hate it.",
            isPro: false,
        },
        5: {
            text: "No way!",
            isPro: false
        },
        6: {
            text: "Yes this is good",
            isPro: true
        }
    }
};

function get(type, id) {
    var data = _.extend({}, db[type][id]);

    if (type === 'proposal') {
        data.key = '/proposal/' + id;
        var points = [];
        for (var x = 0; x < data.points.length; ++x) {
            points.push({key: '/point/' + data.points[x]});
        }
        data.points = points;
    } else if (type === 'point') {
        data.key = '/point/' + id;
    }
    return data;
}

function getProposals() {
    var data = _.extend({}, db.proposal);

    return _.map(_.keys(data), function(key) {
        return get('proposal', key);
    });
}

function parseId(id) {
    var num = parseInt(id);

    if (isNaN(num) || !isFinite(num)) {
        throw new Error("bad id");
    }

    return num;
}

app.get('/proposals', function(req, res) {
    res.send({
        key: '/proposals',
        proposals: getProposals()
    });
});

app.get('/proposal/:id', function(req, res) {
    var id = parseId(req.params.id);
    res.send(get('proposal', id));
});

app.get('/point/:id', function(req, res) {
    var id = parseId(req.params.id);
    res.send(get('point', id));
});

var server = app.listen(9900, function() {
    console.log('Listening on port %d', server.address().port);
});
