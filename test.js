const parseSiprecPayload = require('./payload-parser');
const constructSiprecPayload = require('./payload-combiner');
const {getAvailableRtpengine} = require('./utils');
const uuidv4 = require('uuid/v4');
const debug = require('debug')('drachtio:siprec-recording-server');
const fs = require('fs');

module.exports = (req, res) => {
  const callid = req.get('Call-ID');
  const from = req.getParsedHeader('From');
  const logger = req.srf.locals.logger.child({callid});
  const opts = {
    req,
    res,
    logger,
    callDetails: {
      'call-id': callid,
      'from-tag': from.params.tag
    }
  };

  logger.info(`received SIPREC invite: ${req.uri}`);

  connectCall(opts)


};

function connectCall(opts) {
  const rtpEngine = getAvailableRtpengine();

  parseSiprecPayload(opts)
    .then(allocateEndpoint.bind(null, 'caller', rtpEngine))
    .then(allocateEndpoint.bind(null, 'callee', rtpEngine))
    .then(respondToInvite)
    .then((dlg) => {
      logger.info(`call connected successfully, using rtpengine at ${JSON.stringify(rtpEngine.remote)}`);
      return dlg.on('destroy', onCallEnd.bind(null, rtpEngine, opts));
    })
    .catch((err) => {
      logger.error(`Error connecting call: ${err}`);
      connectCall(opts)
    });

}

function allocateEndpoint(which, rtpEngine, opts) {
  const args = Object.assign({}, opts.callDetails, {
    'sdp': which === 'caller' ? opts.sdp1 : opts.sdp2,
    'replace': ['origin', 'session-connection'],
    'ICE': 'remove',
    'record call': 'yes'
  });
  if (which === 'callee') Object.assign(args, {'to-tag': uuidv4()});

  debug(`callDetails: ${opts.callDetails}`);
  debug(`rtpengine args for ${which}: ${JSON.stringify(args)}, sending to ${JSON.stringify(rtpEngine.remote)}`);
  return rtpEngine[which === 'caller' ? 'offer' : 'answer'](rtpEngine.remote, args)
    .then((response) => {
      if (response.result !== 'ok') {
        throw new Error('error connecting to rtpengine');
      }
      opts[which === 'caller' ? 'rtpengineCallerSdp' : 'rtpengineCalleeSdp'] = response.sdp;
      return opts;
    });
}

function respondToInvite(opts) {
  const srf = opts.req.srf;
  const payload = constructSiprecPayload(opts.rtpengineCallerSdp, opts.rtpengineCalleeSdp);
  return srf.createUAS(opts.req, opts.res, {localSdp: payload});
}

function onCallEnd(rtpEngine, opts) {
  opts.logger.info('call ended');

  return rtpEngine.delete(rtpEngine.remote, opts.callDetails)
    .then((response) => {
	//onst req = opt.req;
	var myFileName = opts.req.headers['call-id'];
        var myFileExtTemp = ".part";
        var myFileExt = ".xml";
        var myFilePath = "/app/metadata/";
        var myFileTemp =`${myFilePath}${myFileName}${myFileExtTemp}`;
        var myFile =`${myFilePath}${myFileName}${myFileExt}`;
	fs.rename(myFileTemp, myFile, function (err) {
	  if (err) throw err;
	  console.log('renamed complete');
	  });

      return debug(`response to rtpengine delete: ${JSON.stringify(response)}`);
    });
}
