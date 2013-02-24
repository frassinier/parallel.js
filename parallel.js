/*
 *  Library: parallel.js
 *  Author: Adam Savitzky
 *  License: Creative Commons 3.0
 */
(function (isNode, _) {

var Worker = isNode ? require('./worker') : window.Worker,
    URL = isNode ? require('./url') : window.URL,
    Blob =  isNode ? require('./blob') : window.Blob;

var Parallel = (function  () {

    var _require = (function () {
        var state = {
            files: [],
            funcs: []
        };

        var isUrl = function (test) {
            var r = new RegExp('^(http|https|file)\://[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,3}(:[a-zA-Z0-9]*)?/?([a-zA-Z0-9\-\._\?\,\'/\\\+&amp;%\$#\=~])*$');
            return r.test(test);
        }

        var makeUrl = function (fileName) {
            return isUrl(fileName) ? fileName : [window.location.origin, fileName].join('/');
        };

        var setter = function () {
            var args = _.toArray(arguments);

            state.funcs = _.filter(args, _.isFunction);
            state.files = _.chain(args).filter(_.isString).map(makeUrl).value();
        };

        setter.state = state;

        return setter;
    })();

    var spawn = (function () {

        var wrapMain = function (fn) {
            var op = fn.toString();

            return isNode ?
                'process.on("message", function (m) { process.send({ data : JSON.stringify((' + op + ').apply(process, JSON.parse(m))) }); });' :
                'self.onmessage = function (e) { self.postMessage(JSON.stringify((' + op + ').apply(self, JSON.parse(e.data)))); };';
        };

        var wrapFiles = function (str) {
            return isNode ?
                (_require.state.files.length ? _.map(_require.state.files, function (f) { return 'require(' + f + ');'; }).join('') : '') + str :
                (_require.state.files.length ? 'importScripts("' + _require.state.files.join('","') + '");' : '') + str;
        };

        var wrapFunctions = function (str) {
            return str + (_require.state.funcs.length ? _.invoke(_require.state.funcs, 'toString').join(';') + ';' : '');
        };

        var wrap = _.compose(wrapFunctions, wrapFiles, wrapMain);

        var RemoteRef = function (fn) {
            var str = wrap(fn),
                blob = new Blob([str], { type: 'text/javascript' }),
                url = URL.createObjectURL(blob),
                worker = new Worker(url);

            worker.onmessage = _.bind(this.onWorkerMsg, worker);

            this.worker = worker;
            this.worker.ref = this;
        };

        RemoteRef.prototype.onWorkerMsg = function (e) {
            this.ref.data = JSON.parse(e.data);
        };

        RemoteRef.prototype.data = undefined;

        RemoteRef.prototype.fetch = function (cb) {
            if (this.data === '___terminated') {
                return;
            }

            var data = this.data ? (cb ? cb(this.data): this.data) : (setTimeout(_.bind(this.fetch, this, cb), 0) && undefined);

            data && this.worker.terminate();

            return data;
        };

        RemoteRef.prototype.terminate = function () {
            this.data = '___terminated';
            this.worker.terminate();
        };

        return function (fn, args) {
            var r = new RemoteRef(fn);
            r.worker.postMessage(JSON.stringify([].concat(args)));

            return r;
        };

    })();

    var mapreduce = (function () {

        var DistributedProcess = function (mapper, reducer, chunks) {
            this.mapper = mapper;
            this.reducer = reducer;
            this.chunks = chunks;
            this.refs = _.map(chunks, function (chunk) {
                return spawn(mapper, [].concat(chunk));
            });
        };

        DistributedProcess.prototype.fetch = function (cb) {
            var results = this.fetchRefs(),
                that = this;

            if (_.isEqual(results, _.without(results, undefined))) {
                return cb ? cb(_.reduce(results, this.reducer)) : _.reduce(results, this.reducer);
            }

            setTimeout(function () {
                that.fetch(cb);
            }, 100);
        };


        DistributedProcess.prototype.fetchRefs = function (cb) {
            return _.map(this.refs, function (ref) {
                return ref.fetch(cb || undefined);
            }, this);
        };

        DistributedProcess.prototype.terminate = function (n) {
            n !== undefined ? this.refs[n].terminate() : _.invoke(this.refs, 'terminate');
        };

        return function (mapper, reducer, chunks, cb) {
            var d = new DistributedProcess(mapper, reducer, chunks);

            d.fetch(cb);

            return d;
        }
    })();

    return {
        mapreduce: mapreduce,
        spawn: spawn,
        require: _require
    };

})();

if (isNode) {
    this.exports = Parallel;
} else {
    this.Parallel = Parallel;
}

}).call(typeof module !== 'undefined' && module.exports ? module : window, // context
        typeof module !== 'undefined' && module.exports, // isNode
        typeof module !== 'undefined' && module.exports ? require('underscore') : _); // underscore 
