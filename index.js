// Public entry point.
'use strict';
module.exports = {
  EmailMatch: require('./lib/inbox/email-match'),
  ContentMatch: require('./lib/inbox/content-match'),
  Detectors: require('./lib/inbox/detectors'),
  Identity: require('./lib/core/identity'),
  StatusHints: require('./lib/core/status-hints'),
  LayoutCheck: require('./lib/drawings/layout-check'),
  DRAWING_CHECKLIST: require('./lib/drawings/drawing-checklist'),
};
