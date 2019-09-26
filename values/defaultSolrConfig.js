'use strict';

angular.module('o19s.splainer-search')
  .value('defaultSolrConfig', {
    sanitize:     true,
    highlight:    false,
    debug:        true,
    numberOfRows: 10,
    escapeQuery:  true
  });
