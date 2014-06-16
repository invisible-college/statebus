(function() {
    "use strict";

    var D = React.DOM;

    var app = React.createClass({
        render: function() {
            var proposals = fetch('/proposals');

            var body;

            if (is_loaded(proposals)) {
                body = [];
                proposals.proposals.forEach(function(p) {
                    body.push(D.div({}, [
                        D.b({}, p.title),
                        D.br(),
                        p.description
                    ]));
                });
            } else {
                body = 'Loading...';
            }

            return D.div({}, body);
        }
    });

    $().ready(function() {
        var reactApp = app();

        window.re_render = function() {
            React.renderComponent(reactApp, $('#app').get(0));
        };

        window.re_render();
    });
})();
