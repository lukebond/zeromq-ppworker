var zmq = require('zmq'),
    util = require('util'),
    heartbeatDebug = require('debug')('zeromq-ppworker:heartbeat'),
    debug = require('debug')('zeromq-ppworker:state'),
    EventEmitter = require('events').EventEmitter;

var PPWorker = function (options, workerFn) {
  debug('Starting');
  EventEmitter.call(this);
  this.PPP_READY = new Buffer([1]);
  this.PPP_HEARTBEAT = new Buffer([2]);

  if (!workerFn) {
    throw new Error('Worker function must be supplied');
  }
  this.workerFn = workerFn;

  this.heartbeatLiveness = options.heartbeatLiveness || 5;
  this.heartbeatInterval = options.heartbeatInterval || 1000;
  this.intervalInit = options.intervalInit || 1000;
  this.intervalMax = options.intervalMax || 32000;

  this.url = options.url;
  this._initSocket();

  this.interval = this.intervalInit;
};

util.inherits(PPWorker, EventEmitter);

PPWorker.prototype._handleMessage = function () {
  var args = Array.apply(null, arguments);
  if (this.reconnectTimerId !== -1) {
    // a heartbeat has arrived whilst we were preparing to destroy and recreate the socket. cancel that
    clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = -1;
  }
  if (this.heartbeatTimerId === -1) {
    // for some reason we've received a heartbeat or message when the heartbeat timer wasn't set. schedule it again
    this._initHeartbeat();
  }
  if (args.length === 2 && args[1].toString('utf8') === this.PPP_HEARTBEAT.toString('utf8')) {
    this.liveness = this.heartbeatLiveness;
  }
  else if (args.length === 2) {
    this.workerFn(function (data) {
      if (typeof data !== 'string') {
        data = JSON.stringify(data);
      }
      var message = [args[1], data];
      this.worker.send(message);
      this.emit('work', message);
      this.liveness = this.heartbeatLiveness;
    }.bind(this));
  }
  else {
    this.emit('error', new Error('Invalid message'));
  }
  this.interval = this.intervalInit;
};

PPWorker.prototype._checkHeartbeat = function () {
  if (--this.liveness === 0) {
    // we haven't received a heartbeat in too long
    this.reconnectTimerId = setTimeout(this._heartbeatFailure.bind(this), this.interval);
    if (this.heartbeatTimerId) {
      clearTimeout(this.heartbeatTimerId);
      this.heartbeatTimerId = -1;
    }
  }
  else {
    this.worker.send(this.PPP_HEARTBEAT);
    this._initHeartbeat();
  }
};

PPWorker.prototype._initSocket = function () {
  this.worker = zmq.socket('dealer');
  this.worker.setMaxListeners(3);
  this.worker.identity = 'ppw-' + process.pid;
  this.zmqConnected = false;
  this.worker.connect(this.url);
  this.worker.monitor()
    .on('connect', function () {
      debug('on connect');
      if (!this.zmqConnected) {
        debug('on connect and !this.zmqConnected');
        this.worker.removeAllListeners('message');
        this.worker.on('message', this._handleMessage.bind(this));
        this.worker.send(this.PPP_READY);
        this.liveness = this.heartbeatLiveness;
        this.zmqConnected = true;
        this._initHeartbeat();
      }
    }.bind(this))
    .on('disconnect', function () {
      debug('on disconnect and this.zmqConnected');
      if (this.zmqConnected) {
        this.worker.removeAllListeners('message');
        this.zmqConnected = false;
        if (this.reconnectTimerId) {
          clearTimeout(this.reconnectTimerId);
        }
        this.reconnectTimerId = setTimeout(this._heartbeatFailure.bind(this), this.interval);
        if (this.heartbeatTimerId !== -1) {
          clearTimeout(this.heartbeatTimerId);
          this.heartbeatTimerId = -1;
        }
      }
    }.bind(this));
};

PPWorker.prototype._initHeartbeat = function () {
  if (this.heartbeatTimerId !== -1) {
    clearTimeout(this.heartbeatTimerId);
  }
  heartbeatDebug('initHeartbeat in: ' + this.heartbeatInterval);
  this.heartbeatTimerId = setTimeout(this._checkHeartbeat.bind(this), this.heartbeatInterval);
  if (this.reconnectTimerId !== -1) {
    clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = -1;
  }
};

PPWorker.prototype._heartbeatFailure = function () {
  if (this.interval < this.intervalMax) {
    this.interval *= 2;
  }
  heartbeatDebug('_heartbeatFailure interval: ' + this.interval);
  this.worker.close();
  this.worker = null;
  this._initSocket();
};

module.exports = PPWorker;
