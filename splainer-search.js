angular.module('o19s.splainer-search', []);

'use strict';

// Executes a solr search and returns
// a set of queryDocs
angular.module('o19s.splainer-search')
  .service('baseExplainSvc', [
    'vectorSvc',
    function explainSvc(vectorSvc) {

      this.Explain = function(explJson, explFactory) {
        var datExplain = this;
        this.asJson = explJson;
        this.realContribution = this.score = parseFloat(explJson.value);
        this.realExplanation = this.description = explJson.description;
        var details = [];
        if (explJson.hasOwnProperty('details')) {
          details = explJson.details;
        }
        this.children = [];
        angular.forEach(details, function(detail) {
          var expl = explFactory(detail);
          if (expl) {
            datExplain.children.push(expl);
          }
        });

        /* Each explain defines influencers,
         *
         * whatever this explain feels should be
         * plucked out of the explJson passed in as a list
         * of things that explain it
         * */
        this.influencers = function() {
          return [];
        };

        /* Each explain reports its contribution
         * */
        this.contribution = function() {
          return this.realContribution;
        };

        /* Each explain reports a more human-readable form
         * of the explain text that hopefully is less search geeky
         * */
        this.explanation = function() {
          return this.realExplanation;
        };

        /* Once we get to "matches" we intend to
         * stop, and the level below becomes heavily related to
         * similarity implementations (how does the tf * idf calculation work)
         * we'll call that out seperately to keep things sane
         * */
        this.hasMatch = function() {
          return false;
        };

        /* Return my influencers as a vector
         * where magnitude of each dimension is how
         * much I am influenced by that influencer
         *
         * IE if I am a SumExplain, my vector is likely to be
         * for matches x and y with scores a and y respectively
         *
         *  a * x + b * y
         *
         *  here a and b are constants, x and y are other
         *  matches to be recursively expanded
         *
         * */
        this.vectorize = function() {
          var rVal = vectorSvc.create();
          // base vector is just a, no expansion farther down
          // so any children's expansion will get ignored
          rVal.set(this.explanation(), this.contribution());
          return rVal;
        };

        var mergeInto = function(sink, source) {
          for (var attrname in source) { sink[attrname] = source[attrname]; }
          return sink;
        };
        this.matchDetails = function() {
          var rVal = {};
          angular.forEach(this.children, function(child) {
            mergeInto(rVal, child.matchDetails());
          });
          return rVal;
        };

        /* A friendly, hiererarchical view
         * of all the influencers
         * */
        var asStr = '';
        var asRawStr = '';
        this.toStr = function(depth) {
          if (asStr === '') {
            if (depth === undefined) {
              depth = 0;
            }
            var prefix = new Array(2 * depth).join(' ');
            var me = prefix + this.contribution() + ' ' + this.explanation() + '\n';
            var childStrs = [];
            angular.forEach(this.influencers(), function(child) {
              childStrs.push(child.toStr(depth+1));
            });
            asStr = me + childStrs.join('\n');
          }
          return asStr;
        };

        this.rawStr = function() {
          /* global JSON */
          if (asRawStr === '') {
            asRawStr = JSON.stringify(this.asJson);
          }
          return asRawStr;
        };
      };
    }
  ]);

'use strict';

/* Some browsers and PhantomJS don't support bind, mozilla provides
 * this implementation as a monkey patch on Function.prototype
 *
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind?redirectlocale=en-US&redirectslug=JavaScript%2FReference%2FGlobal_Objects%2FFunction%2Fbind
 */

if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5 internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }

    var aArgs = Array.prototype.slice.call(arguments, 1),
        fToBind = this,
        FNOP = function () {},
        fBound = function () {
          return fToBind.apply(this instanceof FNOP && oThis ? this
                              : oThis,
                               aArgs.concat(Array.prototype.slice.call(arguments)));
        };

    FNOP.prototype = this.prototype;
    fBound.prototype = new FNOP();

    return fBound;
  };
}

'use strict';

// Resolves a set of ids to Normal docs
angular.module('o19s.splainer-search')
  .service('docResolverSvc', [
    'ResolverFactory',
    function docResolverSvc(ResolverFactory) {
      this.createResolver = function(ids, settings, chunkSize) {
        return new ResolverFactory(ids, settings, chunkSize);
      };
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('esExplainExtractorSvc', [
    'normalDocsSvc',
    function esExplainExtractorSvc(normalDocsSvc) {
      var self = this;

      // Functions
      self.docsWithExplainOther = docsWithExplainOther;

      function docsWithExplainOther(docs, fieldSpec) {
        var parsedDocs = [];

        angular.forEach(docs, function(doc) {
          var normalDoc = normalDocsSvc.createNormalDoc(fieldSpec, doc);
          parsedDocs.push(normalDoc);
        });

        return parsedDocs;
      }
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('esSearcherPreprocessorSvc', [
    'queryTemplateSvc',
    'defaultESConfig',
    function esSearcherPreprocessorSvc(queryTemplateSvc, defaultESConfig) {
      var self = this;

      // Attributes
      // field name since ES 5.0
      self.fieldsParamNames = [ '_source'];

      // Functions
      self.prepare  = prepare;

      var replaceQuery = function(args, queryText) {
        if (queryText) {
          queryText = queryText.replace(/\\/g, '\\\\');
          queryText = queryText.replace(/"/g, '\\\"');
        }

        var replaced  = angular.toJson(args, true);

        replaced      = queryTemplateSvc.hydrate(replaced, queryText, {encodeURI: false, defaultKw: '\\"\\"'});
        replaced      = angular.fromJson(replaced);

        return replaced;
      };

      var prepareHighlighting = function (args, fields) {
        if ( angular.isDefined(fields) && fields !== null ) {
          if ( fields.hasOwnProperty('fields') ) {
            fields = fields.fields;
          }

          if ( fields.length > 0 ) {
            var hl = { fields: {} };

            angular.forEach(fields, function(fieldName) {
              hl.fields[fieldName] = { };
            });

            return hl;
          }
        }

        return {
          fields: {
            _all: {}
          }
        };
      };

      var preparePostRequest = function (searcher) {
        var pagerArgs = angular.copy(searcher.args.pager);
        if ( angular.isUndefined(pagerArgs) || pagerArgs === null ) {
          pagerArgs = {};
        }

        var defaultPagerArgs = {
          from: 0,
          size: searcher.config.numberOfRows,
        };

        searcher.pagerArgs  = angular.merge({}, defaultPagerArgs, pagerArgs);
        delete searcher.args.pager;

        var queryDsl        = replaceQuery(searcher.args, searcher.queryText);
        queryDsl.explain    = true;

        if ( angular.isDefined(searcher.fieldList) && searcher.fieldList !== null ) {
          angular.forEach(self.fieldsParamNames, function(name) {
            queryDsl[name] = searcher.fieldList;
          });
        }

        if ( !queryDsl.hasOwnProperty('highlight') ) {
          queryDsl.highlight = prepareHighlighting(searcher.args, queryDsl[self.fieldsParamNames[0]]);
        }

        searcher.queryDsl   = queryDsl;
      };

      var prepareGetRequest = function (searcher) {
        searcher.url = searcher.url + '?q=' + searcher.queryText;

        var pagerArgs = angular.copy(searcher.args.pager);
        delete searcher.args.pager;

        if ( angular.isDefined(pagerArgs) && pagerArgs !== null ) {
          searcher.url += '&from=' + pagerArgs.from;
          searcher.url += '&size=' + pagerArgs.size;
        } else {
          searcher.url += '&size=' + searcher.config.numberOfRows;
        }
      };

      var setFieldsParamName = function() {
        self.fieldsParamNames = [ '_source'];
      };

      function prepare (searcher) {
        if (searcher.config === undefined) {
          searcher.config = defaultESConfig;
        } else {
          // make sure config params that weren't passed through are set from
          // the default config object.
          searcher.config = angular.merge({}, defaultESConfig, searcher.config);
        }

        setFieldsParamName(searcher);

        if ( searcher.config.apiMethod === 'post') {
          preparePostRequest(searcher);
        } else if ( searcher.config.apiMethod === 'get') {
          prepareGetRequest(searcher);
        }
      }
    }
  ]);

'use strict';

/*global URI*/
angular.module('o19s.splainer-search')
  .service('esUrlSvc', [
    function esUrlSvc() {

      var self      = this;

      self.parseUrl         = parseUrl;
      self.buildDocUrl      = buildDocUrl;
      self.buildExplainUrl  = buildExplainUrl;
      self.buildUrl         = buildUrl;
      self.buildBaseUrl     = buildBaseUrl;
      self.setParams        = setParams;
      self.getHeaders       = getHeaders;
      self.isBulkCall       = isBulkCall;

      /**
       *
       * private method fixURLProtocol
       * Adds 'http://' to the beginning of the URL if no protocol was specified.
       *
       */
      var protocolRegex = /^https{0,1}\:/;
      function fixURLProtocol(url) {
        if (!protocolRegex.test(url)) {
          url = 'http://' + url;
        }
        return url;
      }

      /**
       *
       * Parses an ES URL of the form [http|https]://[username@password:][host][:port]/[collectionName]/_search
       * Splits up the different parts of the URL.
       *
       */
      function parseUrl (url) {
        url = fixURLProtocol(url);
        var a = new URI(url);

        var esUri = {
          protocol: a.protocol(),
          host:     a.host(),
          pathname: a.pathname(),
          username: a.username(),
          password: a.password(),
          query:    a.query(),
        };

        if (esUri.pathname.endsWith('/')) {
          esUri.pathname = esUri.pathname.substring(0, esUri.pathname.length - 1);
        }

        return esUri;
      }

      /**
       *
       * Builds ES URL of the form [protocol]://[host][:port]/[index]/[type]/[id]
       * for an ES document.
       *
       */
      function buildDocUrl (uri, doc) {
        var index = doc._index;
        var type  = doc._type;
        var id    = doc._id;

        var url = self.buildBaseUrl(uri);
        url = url + '/' + index + '/' + type + '/' + id;

        return url;
      }


      /**
       *
       * Builds ES URL of the form [protocol]://[host][:port]/[index]/[type]/[id]/_explain
       * for an ES document.
       *
       */
      function buildExplainUrl (uri, doc) {
        var docUrl = self.buildDocUrl(uri, doc);

        var url = docUrl + '/_explain';

        return url;
      }

      /**
       *
       * Builds ES URL for a search query.
       * Adds any query params if present: /_search?from=10&size=10
       */
      function buildUrl (uri) {
        var self = this;

        var url = self.buildBaseUrl(uri);
        url = url + uri.pathname;

        // Return original URL if no params to append.
        if ( angular.isUndefined(uri.params) && angular.isUndefined(uri.query) ) {
          return url;
        }

        var paramsAsStrings = [];

        angular.forEach(uri.params, function(value, key) {
          paramsAsStrings.push(key + '=' + value);
        });

        if ( angular.isDefined(uri.query) && uri.query !== '' ) {
          paramsAsStrings.push(uri.query);
        }

        // Return original URL if no params to append.
        if ( paramsAsStrings.length === 0 ) {
          return url;
        }

        var finalUrl = url;

        if (finalUrl.substring(finalUrl.length - 1) === '?') {
          finalUrl += paramsAsStrings.join('&');
        } else {
          finalUrl += '?' + paramsAsStrings.join('&');
        }

        return finalUrl;
      }

      function buildBaseUrl (uri) {
        var url = uri.protocol + '://';
        if (uri.password && uri.username) {
          url += uri.username + ':' + uri.password + '@';
        }
        url += (uri.host);

        return url;
      }

      function setParams (uri, params) {
        uri.params = params;
      }

      function getHeaders (uri) {
        var headers = {};

        if ( angular.isDefined(uri.username) && uri.username !== '' &&
          angular.isDefined(uri.password) && uri.password !== '') {
          var authorization = 'Basic ' + btoa(uri.username + ':' + uri.password);
          headers = { 'Authorization': authorization };
        }

        return headers;
      }

      function isBulkCall (uri) {
        return uri.pathname.endsWith('_msearch');
      }
    }
  ]);

'use strict';

// Factory for explains
// really ties the room together
angular.module('o19s.splainer-search')
  .service('explainSvc', [
    'baseExplainSvc',
    'queryExplainSvc',
    'simExplainSvc',
    function explainSvc(baseExplainSvc, queryExplainSvc, simExplainSvc) {

      var Explain = baseExplainSvc.Explain;
      var ConstantScoreExplain = queryExplainSvc.ConstantScoreExplain;
      var MatchAllDocsExplain = queryExplainSvc.MatchAllDocsExplain;
      var WeightExplain = queryExplainSvc.WeightExplain;
      var FunctionQueryExplain = queryExplainSvc.FunctionQueryExplain;
      var DismaxTieExplain = queryExplainSvc.DismaxTieExplain;
      var DismaxExplain = queryExplainSvc.DismaxExplain;
      var SumExplain = queryExplainSvc.SumExplain;
      var CoordExplain = queryExplainSvc.CoordExplain;
      var ProductExplain = queryExplainSvc.ProductExplain;
      var MinExplain = queryExplainSvc.MinExplain;
      var EsFieldFunctionQueryExplain = queryExplainSvc.EsFieldFunctionQueryExplain;
      var EsFuncWeightExplain = queryExplainSvc.EsFuncWeightExplain;

      var FieldWeightExplain = simExplainSvc.FieldWeightExplain;
      var QueryWeightExplain = simExplainSvc.QueryWeightExplain;
      var DefaultSimTfExplain = simExplainSvc.DefaultSimTfExplain;
      var DefaultSimIdfExplain = simExplainSvc.DefaultSimIdfExplain;
      var ScoreExplain = simExplainSvc.ScoreExplain;

      var meOrOnlyChild = function(explain) {
        var infl = explain.influencers();
        if (infl.length === 1) {
          return infl[0]; //only child
        } else {
          return explain;
        }
      };

      var replaceBadJson = function(explJson) {
        var explJsonIfBad = {
          details: [],
          description: 'no explain for doc',
          value: 0.0,
          match: true
        };
        if (!explJson) {
          return explJsonIfBad;
        } else {
          return explJson;
        }
      };

      var tieRegex = /max plus ([0-9.]+) times/;
      var prefixRegex = /\:.*?\*(\^.+?)?, product of/;
      var createExplain = function(explJson) {
        explJson = replaceBadJson(explJson);
        var base = new Explain(explJson, createExplain);
        var description = explJson.description;
        var details = [];
        var IGNORED = null;
        var tieMatch = description.match(tieRegex);
        var prefixMatch = description.match(prefixRegex);
        if (explJson.hasOwnProperty('details')) {
          details = explJson.details;
        }
        if (description.startsWith('score(')) {
          ScoreExplain.prototype = base;
          return new ScoreExplain(explJson);
        }
        if (description.startsWith('tf(')) {
          DefaultSimTfExplain.prototype = base;
          return new DefaultSimTfExplain(explJson);
        }
        else if (description.startsWith('idf(')) {
          DefaultSimIdfExplain.prototype = base;
          return new DefaultSimIdfExplain(explJson);
        }
        else if (description.startsWith('fieldWeight')) {
          FieldWeightExplain.prototype = base;
          return new FieldWeightExplain(explJson);
        }
        else if (description.startsWith('queryWeight')) {
          QueryWeightExplain.prototype = base;
          return new QueryWeightExplain(explJson);
        }
        if (description.startsWith('ConstantScore')) {
          ConstantScoreExplain.prototype = base;
          return new ConstantScoreExplain(explJson);
        }
        else if (description.startsWith('MatchAllDocsQuery')) {
          MatchAllDocsExplain.prototype = base;
          return new MatchAllDocsExplain(explJson);
        }
        else if (description.startsWith('weight(')) {
          WeightExplain.prototype = base;
          return new WeightExplain(explJson);
        }
        else if (description.startsWith('FunctionQuery')) {
          FunctionQueryExplain.prototype = base;
          return new FunctionQueryExplain(explJson);
        }
        else if (description.startsWith('Function for field')) {
          EsFieldFunctionQueryExplain.prototype = base;
          return new EsFieldFunctionQueryExplain(explJson);
        }
        else if (prefixMatch && prefixMatch.length > 1) {
          WeightExplain.prototype = base;
          return new WeightExplain(explJson);
        }
        else if (description.startsWith('match on required clause') || description.startsWith('match filter')) {
          return IGNORED; // because Elasticsearch funciton queries filter when they apply boosts (this doesn't matter in scoring)
        }
        else if (description.startsWith('queryBoost')) {
          if (explJson.value === 1.0) {
            return IGNORED; // because Elasticsearch function queries always add 'queryBoost' of 1, even when boost not specified
          }
        }
        else if (description.hasSubstr('constant score') && description.hasSubstr('no function provided')) {
          return IGNORED;
        }
        else if (description === 'weight') {
          EsFuncWeightExplain.prototype = base;
          return new EsFuncWeightExplain(explJson);
        }
        else if (tieMatch && tieMatch.length > 1) {
          var tie = parseFloat(tieMatch[1]);
          DismaxTieExplain.prototype = base;
          return new DismaxTieExplain(explJson, tie);
        }
        else if (description.hasSubstr('max of')) {
          DismaxExplain.prototype = base;
          return meOrOnlyChild(new DismaxExplain(explJson));
        }
        else if (description.hasSubstr('sum of')) {
          SumExplain.prototype = base;
          return meOrOnlyChild(new SumExplain(explJson));
        }
        else if (description.hasSubstr('Math.min of')) {
          MinExplain.prototype = base;
          return meOrOnlyChild(new MinExplain(explJson));
        }
        else if (description.hasSubstr('min of')) {
          MinExplain.prototype = base;
          return meOrOnlyChild(new MinExplain(explJson));
        }
        else if (description.hasSubstr('score mode [multiply]')) {
          ProductExplain.prototype = base;
          return meOrOnlyChild(new ProductExplain(explJson));
        }
        else if (description.hasSubstr('product of')) {
          var coordExpl = null;
          if (details.length === 2) {
            angular.forEach(details, function(detail) {
              if (detail.description.startsWith('coord(')) {
                CoordExplain.prototype = base;
                coordExpl = new CoordExplain(explJson, parseFloat(detail.value));
              }
            });
          }
          if (coordExpl !== null) {
            return coordExpl;
          } else {
            ProductExplain.prototype = base;
            return meOrOnlyChild(new ProductExplain(explJson));
          }
        }
        return base;

      };

      this.createExplain = function(explJson) {
        return createExplain(explJson);
      };
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('fieldSpecSvc', [
    function fieldSpecSvc() {
      var addFieldOfType = function(fieldSpec, fieldType, fieldName) {
        if (fieldType === 'function') {
          if (!fieldSpec.hasOwnProperty('functions')) {
            fieldSpec.functions = [];
          }
          // a function query function:foo is really foo:$foo
          if (fieldName.startsWith('$')) {
            fieldName = fieldName.slice(1);
          }
          fieldName = fieldName + ':$' + fieldName;
          fieldSpec.functions.push(fieldName);
        }
        if (fieldType === 'sub') {
          if (!fieldSpec.hasOwnProperty('subs')) {
            fieldSpec.subs = [];
          }
          if (fieldSpec.subs !== '*') {
            fieldSpec.subs.push(fieldName);
          }
          if (fieldName === '*') {
            fieldSpec.subs = '*';
          }
        }
        else if (!fieldSpec.hasOwnProperty(fieldType)) {
          fieldSpec[fieldType] = fieldName;
        }
        fieldSpec.fields.push(fieldName);
      };

      var normalizeFieldTypeAliases = function(fieldType) {
        if (fieldType === 'func' || fieldType === 'f') {
          return 'function';
        }
        return fieldType;
      };

      // Populate field spec from a field spec string
      var populateFieldSpec = function(fieldSpec, fieldSpecStr) {
        var fieldSpecs = fieldSpecStr.split('+').join(' ').split(/[\s,]+/);
        angular.forEach(fieldSpecs, function(aField) {
          var typeAndField = aField.split(':');
          var fieldType = null;
          var fieldName = null;
          if (typeAndField.length === 2) {
            fieldType = normalizeFieldTypeAliases(typeAndField[0]);
            fieldName = typeAndField[1];
          }
          else if (typeAndField.length === 1) {
            fieldName = typeAndField[0];
            if (fieldSpec.hasOwnProperty('title')) {
              fieldType = 'sub';
            }
            else {
              fieldType = 'title';
            }
          }
          if (fieldType && fieldName) {
            addFieldOfType(fieldSpec, fieldType, fieldName);
          }
        });
      };


      var FieldSpec = function(fieldSpecStr) {
        this.fields = [];
        this.fieldSpecStr = fieldSpecStr;
        populateFieldSpec(this, fieldSpecStr);
        if (!this.hasOwnProperty('id')) {
          this.id = 'id';
          this.fields.push('id');
        }

        if (!this.hasOwnProperty('title')) {
          this.title = this.id;
        }

        this.fieldList = function() {
          if (this.hasOwnProperty('subs') && this.subs === '*') {
            return '*';
          }
          var rVal = [this.id];
          this.forEachField(function(fieldName) {
            rVal.push(fieldName);
          });
          return rVal;
        };

        // Execute innerBody for each (non id) field
        this.forEachField = function(innerBody) {
          if (this.hasOwnProperty('title')) {
            innerBody(this.title);
          }
          if (this.hasOwnProperty('thumb')) {
            innerBody(this.thumb);
          }
          angular.forEach(this.subs, function(sub) {
            innerBody(sub);
          });
          angular.forEach(this.functions, function(func) {
            innerBody(func);
          });
        };
      };

      var transformFieldSpec = function(fieldSpecStr) {
        var defFieldSpec = 'id:id title:id *';
        var fieldSpecs = fieldSpecStr.split(/[\s,]+/);
        if (fieldSpecStr.trim().length === 0) {
          return defFieldSpec;
        }
        if (fieldSpecs[0] === '*') {
          return defFieldSpec;
        }
        return fieldSpecStr;
      };

      this.createFieldSpec = function(fieldSpecStr) {
        fieldSpecStr = transformFieldSpec(fieldSpecStr);
        return new FieldSpec(fieldSpecStr);
      };

    }
  ]);

'use strict';

// Deals with normalizing documents from the search engine
// into a canonical representation, ie
// each doc has an id, a title, possibly a thumbnail field
// and possibly a list of sub fields
angular.module('o19s.splainer-search')
  .service('normalDocsSvc', [
    'explainSvc',
    function normalDocsSvc(explainSvc) {
      var entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '\"': '&quot;',
        '\'': '&#39;',
        '/': '&#x2F;'
      };

      var escapeHtml = function(string) {
        return String(string).replace(/[&<>"'\/]/g, function (s) {
          return entityMap[s];
        });
      };

      //
      // Takes an array of keys and fetches the nested value
      // by traversing the object map in parallel as the list of keys.
      //
      // @param obj,  Object, the object we want to fetch value from.
      // @param keys, Array,  the list of keys.
      //
      // Example:
      // obj:  { a: { b: 'c' } }
      // keys: [ 'a', 'b' ]
      // returns: obj['a']['b'] => c
      //
      var multiIndex = function(obj, keys) {
        return keys.length ? multiIndex(obj[keys[0]], keys.slice(1)) : obj;
      };

      //
      // Takes a dot notation and returns the value of the object by
      // traversing the key map.
      //
      // @param obj,  Object, the object we want to fetch value from.
      // @param keys, String, the dot notation of the keys.
      //
      // Example:
      // obj:  { a: { b: 'c' } }
      // keys: 'a.b'
      // returns: obj['a']['b'] => c
      //
      var pathIndex = function(obj, keys) {
        return multiIndex(obj, keys.split('.'));
      };

      var assignSingleField = function(normalDoc, doc, field, toProperty) {
        if ( /\./.test(field) ) {
          try {
            var value = pathIndex(doc, field);
            normalDoc[toProperty] = '' + value;
          } catch (e) {
            normalDoc[toProperty] = '';
          }
        } else if ( doc.hasOwnProperty(field) ) {
          normalDoc[toProperty] = '' + doc[field];
        }
      };

      var fieldDisplayName = function(funcFieldQuery) {
        // to Solr this is sent as foo:$foo, we just want to display "foo"
        return funcFieldQuery.split(':')[0];
      };

      var assignSubs = function(normalDoc, doc, fieldSpec) {
        var parseValue = function(value) {
          if ( typeof value === 'object' ) {
            return value;
          } else {
            return '' + value;
          }
        };

        if (fieldSpec.subs === '*') {
          angular.forEach(doc, function(value, fieldName) {
            if (typeof(value) !== 'function') {
              if (fieldName !== fieldSpec.id && fieldName !== fieldSpec.title &&
                  fieldName !== fieldSpec.thumb) {
                normalDoc.subs[fieldName] = parseValue(value);
              }
            }
          });
        }
        else {
          angular.forEach(fieldSpec.subs, function(subFieldName) {
            if ( /\./.test(subFieldName) ) {
              try {
                var value = pathIndex(doc, subFieldName);
                normalDoc.subs[subFieldName] = parseValue(value);
              } catch (e) {
                normalDoc.subs[subFieldName] = '';
              }
            } else if ( doc.hasOwnProperty(subFieldName) ) {
              normalDoc.subs[subFieldName] = parseValue(doc[subFieldName]);
            }
          });
          angular.forEach(fieldSpec.functions, function(functionField) {
            // for foo:$foo, look for foo
            var dispName = fieldDisplayName(functionField);

            if (doc.hasOwnProperty(dispName)) {
              normalDoc.subs[dispName] = parseValue(doc[dispName]);
            }
          });
        }
      };

      var assignFields = function(normalDoc, doc, fieldSpec) {
        assignSingleField(normalDoc, doc, fieldSpec.id, 'id');
        assignSingleField(normalDoc, doc, fieldSpec.title, 'title');
        assignSingleField(normalDoc, doc, fieldSpec.thumb, 'thumb');
        normalDoc.subs = {};
        assignSubs(normalDoc, doc, fieldSpec);
      };

      // A document within a query
      var NormalDoc = function(fieldSpec, doc) {
        this.doc = doc;
        assignFields(this, this.doc.source(), fieldSpec);
        var hasThumb = false;
        if (this.hasOwnProperty('thumb')) {
          hasThumb = true;
        }
        this.subsList = [];
        var thisNormalDoc = this;
        angular.forEach(this.subs, function(subValue, subField) {
          var expanded = {field: subField, value: subValue};
          thisNormalDoc.subsList.push(expanded);
        });

        this.hasThumb = function() {
          return hasThumb;
        };

        this._url = function() {
          return this.doc._url(fieldSpec.id, this.id);
        };

      };

      // layer on highlighting features
      var snippitable = function(doc) {
        var aDoc = doc.doc;

        var lastSubSnips = {};
        var lastHlPre = null;
        var lastHlPost = null;
        doc.subSnippets = function(hlPre, hlPost) {
          if (lastHlPre !== hlPre || lastHlPost !== hlPost) {
            angular.forEach(doc.subs, function(subFieldValue, subFieldName) {
              if ( typeof subFieldValue === 'object' && !(subFieldValue instanceof Array)) {
                lastSubSnips[subFieldName] = subFieldValue;
              } else {
                var snip = aDoc.highlight(
                  doc.id,
                  subFieldName,
                  hlPre,
                  hlPost
                );

                if ( null === snip || undefined === snip || '' === snip ) {
                  snip = escapeHtml(subFieldValue.slice(0, 200));
                }

                lastSubSnips[subFieldName] = snip;
              }
            });
          }
          return lastSubSnips;
        };
        return doc;
      };

      // layer on explain features
      var explainable = function(doc, explainJson) {

        var simplerExplain = null;// explainSvc.createExplain(explainJson);
        var hotMatches = null;//simplerExplain.vectorize();
        var matchDetails = null;

        var initExplain = function() {
          if (!simplerExplain) {
            simplerExplain = explainSvc.createExplain(explainJson);
            hotMatches = simplerExplain.vectorize();
            matchDetails = simplerExplain.matchDetails();
          }
        };

        doc.explain = function() {
          initExplain();
          return simplerExplain;
        };

        doc.hotMatches = function() {
          initExplain();
          return hotMatches;
        };

        doc.matchDetails = function() {
          initExplain();
          return matchDetails;
        };

        var hotOutOf = [];
        var lastMaxScore = -1;
        doc.hotMatchesOutOf = function(maxScore) {
          initExplain();
          if (maxScore !== lastMaxScore) {
            hotOutOf.length = 0;
          }
          lastMaxScore = maxScore;
          if (hotOutOf.length === 0) {
            angular.forEach(hotMatches.vecObj, function(value, key) {
              var percentage = ((0.0 + value) / maxScore) * 100.0;
              hotOutOf.push({description: key, metadata: matchDetails[key], percentage: percentage});
            });
            hotOutOf.sort(function(a,b) {return b.percentage - a.percentage;});
          }
          return hotOutOf;
        };

        doc.score = function() {
          initExplain();
          return simplerExplain.contribution();
        };
        return doc;
      };

      var getDocExplain = function(doc, nDoc) {
        var explJson = doc.explain(nDoc.id);
        if (explJson === null) {
          if (doc.source().hasOwnProperty('id')) {
            return doc.explain(doc.source().id);
          }
        }
        return explJson;
      };

      this.createNormalDoc = function(fieldSpec, doc, altExplainJson) {
        var nDoc = new NormalDoc(fieldSpec, doc);
        var explJson;
        if (altExplainJson) {
          explJson = altExplainJson;
        } else {
          explJson = getDocExplain(doc, nDoc);
        }
        return this.snippetDoc(this.explainDoc(nDoc, explJson));
      };

      // Decorate doc with an explain/field values/etc other
      // than what came back from the search engine
      this.explainDoc = function(doc, explainJson) {
        return explainable(doc, explainJson);
      };

      this.snippetDoc = function(doc) {
        return snippitable(doc);
      };

      // A stub, used to display a result that we expected
      // to find, but isn't there
      this.createPlaceholderDoc = function(docId, stubTitle, explainJson) {
        var placeHolder = {id: docId,
                           title: stubTitle};
        if (explainJson) {
          return snippitable(explainable(placeHolder, explainJson));
        } else {
          placeHolder.subSnippets = function() {return '';};
          return placeHolder;
        }
      };
    }
  ]);

'use strict';
// basic promise
(function() {
  var Promise = function(taskFn, taskThis, taskArgs) {
    this.completed = false;
    // when taskFn signals done, do this
    this.$$myFn = taskFn;
    this.then = function(nextTaskFn, nextTaskThisOrArgs, nextTaskArgs) {
      if (nextTaskThisOrArgs instanceof Array) {
        nextTaskArgs = nextTaskThisOrArgs;
        nextTaskThisOrArgs = undefined;
      }
      this.next = new Promise(nextTaskFn, nextTaskThisOrArgs, nextTaskArgs);
      if (this.completed) {
        this.completer();
      }
      return this.next;
    };
    
    // Run the underlying task
    this.apply = function() {
      taskFn.promise = this; // somebody then(...) me!
      taskFn.apply(taskThis, taskArgs);
    };
    
    // We're done, the next thing can run
    this.completer = function() {
      this.completed = true;
      if (this.next) {
        this.next.apply();
        this.completed = false;
      }
    };
    this.complete = this.completer.bind(this);
  };

  Promise.create = function(func) {
    if (func.hasOwnProperty('promise')) {
      // I already have a stub promise waiting for 
      // somebody to call then on
      return func.promise;
    } else {
      var firstPromise = new Promise();
      return firstPromise;
    }
  };
  window.Promise = Promise;
}());

// I have an easier time thinking as an implementor
// in terms of a sequence of asynchronous tasks to be
// chained

'use strict';

// Explains that exist before you get to the match level
angular.module('o19s.splainer-search')
  .service('queryExplainSvc', [
    'baseExplainSvc',
    'vectorSvc',
    'simExplainSvc',
    function explainSvc(baseExplainSvc, vectorSvc, simExplainSvc) {
      var DefaultSimilarityMatch = simExplainSvc.DefaultSimilarityMatch;

      this.MatchAllDocsExplain = function() {
        this.realExplanation = 'Match All Docs (*:*)';
      };

      this.ConstantScoreExplain = function() {
        this.realExplanation = 'Constant Scored Query';
      };

      this.EsFuncWeightExplain = function(explJson) {
        this.realExplanation = 'f( -- constant weight -- ) = ' + explJson.value;
      };

      var shallowArrayCopy = function(src) {
        return src.slice(0);
      };


      this.WeightExplain = function(explJson) {
        // take weight(text:foo in 1234), extract text:foo,
        // this actually deliniates a "match" so the stuff
        // underneath this level in the explain is search nerd trivia
        // tf, idf, norms, etc.
        // We break that out separately, not part of the main explain
        // tree, but as a different hiererarchy
        var weightRegex = /weight\((.*?)\s+in\s+\d+?\)/;
        var description = explJson.description;

        var match = description.match(weightRegex);
        if (match !== null && match.length > 1) {
          this.realExplanation = match[1];
        } else {
          this.realExplanation = description;
          var prodOf = ', product of:';
          if (description.endsWith(prodOf)) {
            var len = description.length - prodOf.length;
            this.realExplanation = description.substring(0, len);
          }
        }

        this.hasMatch = function() {
          return true;
        };

        this.getMatch = function() {
          // Match has lots of goodies based on similarity used
          if (this.description.hasSubstr('DefaultSimilarity')) {
            return new DefaultSimilarityMatch(this.children);
          }
          return null;
        };

        this.explanation = function() {
          var match = this.getMatch();
          var matchStr = '';
          if (match !== null) {
            matchStr = '\n' + match.formulaStr();
          }
          return this.realExplanation;
        };

        this.matchDetails = function() {
          var rVal = {};
          rVal[this.explanation()] = this.rawStr(); //match.formulaStr();
          return rVal;
        };
      };

      this.FunctionQueryExplain = function(explJson) {
        var funcQueryRegex = /FunctionQuery\((.*)\)/;
        var description = explJson.description;
        var match = description.match(funcQueryRegex);
        if (match !== null && match.length > 1) {
          this.realExplanation = match[1];
        } else {
          this.realExplanation = description;
        }
      };

      this.EsFieldFunctionQueryExplain = function(explJson) {
        var funcQueryRegex = /Function for field (.*?):/;
        var description = explJson.description;
        var match = description.match(funcQueryRegex);
        var fieldName = 'unknown';
        if (match !== null && match.length > 1) {
          fieldName = match[1];
        }
        var explText = 'f(' + fieldName + ') = ';
        angular.forEach(this.children, function(child) {
          explText += child.description + ' ';
        });
        this.realExplanation = explText;

      };

      this.MinExplain = function() {
        this.realExplaination = 'Minimum Of:';

        this.influencers = function() {
          var infl = shallowArrayCopy(this.children);
          infl.sort(function(a, b) {return a.score - b.score;});
          return [infl[0]];
        };

        this.vectorize = function() {
          // pick the minimum, which is sorted by influencers
          var infl = this.influencers();
          var minInfl = infl[0];
          return minInfl.vectorize();
          };
      };

      this.CoordExplain = function(explJson, coordFactor) {
        if (coordFactor < 1.0) {
          this.realExplanation = 'Matches Punished by ' + coordFactor + ' (not all query terms matched)';

          this.influencers = function() {
            var infl = [];
            for (var i = 0; i < this.children.length; i++) {
              if (this.children[i].description.hasSubstr('coord')) {
                continue;
              } else {
                infl.push(this.children[i]);
              }
            }
            return infl;
          };

          this.vectorize = function() {
            // scale the others by coord factor
            var rVal = vectorSvc.create();
            angular.forEach(this.influencers(), function(infl) {
              rVal = vectorSvc.add(rVal, infl.vectorize());
            });
            rVal = vectorSvc.scale(rVal, coordFactor);
            return rVal;
          };
        }
      };

      this.DismaxTieExplain = function(explJson, tie) {
        this.realExplanation = 'Dismax (max plus:' + tie + ' times others)';

        this.influencers = function() {
          var infl = shallowArrayCopy(this.children);
          infl.sort(function(a, b) {return b.score - a.score;});
          return infl;
        };

        this.vectorize = function() {
          var infl = this.influencers();
          // infl[0] is the winner of the dismax competition
          var rVal = infl[0].vectorize();
          angular.forEach(infl.slice(1), function(currInfl) {
            var vInfl = currInfl.vectorize();
            var vInflScaled = vectorSvc.scale(vInfl, tie);
            rVal = vectorSvc.add(rVal, vInflScaled);
          });
          return rVal;
        };
      };


      this.DismaxExplain = function() {
        this.realExplanation = 'Dismax (take winner of below)';

        this.influencers = function() {
          var infl = shallowArrayCopy(this.children);
          infl.sort(function(a, b) {return b.score - a.score;});
          return infl;
        };

        this.vectorize = function() {
          var infl = this.influencers();
          // Dismax, winner takes all, influencers
          // are sorted by influence
          return infl[0].vectorize();
        };
      };

      this.SumExplain = function() {
        this.realExplanation = 'Sum of the following:';
        this.isSumExplain = true;

        this.influencers = function() {
          // Well then the child is the real influencer, we're taking sum
          // of one thing
          var infl = [];
          angular.forEach(this.children, function(child) {
            // take advantage of commutative property
            if (child.hasOwnProperty('isSumExplain') && child.isSumExplain) {
              angular.forEach(child.influencers(), function(grandchild) {
                infl.push(grandchild);
              });
            } else {
              infl.push(child);
            }
          });
          return infl.sort(function(a, b) {return b.score - a.score;});
        };

        this.vectorize = function() {
          // vector sum all the components
          var rVal = vectorSvc.create();
          angular.forEach(this.influencers(), function(infl) {
            rVal = vectorSvc.sumOf(rVal, infl.vectorize());
          });
          return rVal;
        };
      };

      this.ProductExplain = function() {
        this.realExplanation = 'Product of following:';

        var oneFilled = function(length) {
          return Array.apply(null, new Array(length)).map(Number.prototype.valueOf,1);
        };

        this.influencers = function() {
          var infl = shallowArrayCopy(this.children);
          infl.sort(function(a, b) {return b.score - a.score;});
          return infl;
        };
        this.vectorize = function() {
          // vector sum all the components
          var rVal = vectorSvc.create();

          var infl = this.influencers();

          var inflFactors = oneFilled(infl.length);

          for (var factorInfl = 0; factorInfl < infl.length; factorInfl++) {
            for (var currMult = 0; currMult < infl.length; currMult++) {
              if (currMult !== factorInfl) {
                inflFactors[factorInfl] = (inflFactors[factorInfl] * infl[currMult].contribution());
              }
            }
          }

          for (var currInfl = 0; currInfl < infl.length; currInfl++) {
            var i = infl[currInfl];
            var thisVec = i.vectorize();
            var thisScaledByOthers = vectorSvc.scale(thisVec, inflFactors[currInfl]);
            rVal = vectorSvc.add(rVal, thisScaledByOthers);
          }

          return rVal;
        };
      };

    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('queryTemplateSvc', function queryTemplateSvc() {
    var self      = this;
    self.hydrate = hydrate;

    var defaultConfig = {
      encodeURI: false,
      defaultKw: '""',
    };

    function encode(queryPart, config) {
      if (config.encodeURI) {
        return encodeURIComponent(queryPart);
      } else {
        return queryPart;
      }
    }

    function getMaxKws(template) {
      var keywordMatch = /#\$keyword\d|(.*?)##/g;
      var match = keywordMatch.exec(template);
      var maxKw = 0;
      while (match !== null) {
        var kwNum = parseInt(match[1]);
        if (kwNum) {
          if (kwNum > maxKw) {
            maxKw = kwNum;
          }
        }
        match = keywordMatch.exec(template);
      }
      return maxKw;
    }

    function keywordMapping(queryText, maxKeywords) {
      var queryTerms    = queryText.split(/[ ,]+/);
      var numTerms = queryTerms.length;
      for (var i = numTerms; i < maxKeywords; i++) {
        queryTerms.push(null);
      }
      return queryTerms;
    }

    function hydrateWithKwDefaults(replaced, config) {
      // Though its possible this link gets out of link, this was the origin
      // of the regex below
      // http://www.regexpal.com/?fam=93576
      replaced = replaced.replace(/#\$keyword\d\|(.*?)##/g, '$1'); // regex
      // anything left, use config defaults
      replaced = replaced.replace(/#\$keyword\d(\|(.*?)){0,1}##/g, config.defaultKw); // regex
      return replaced;
    }

    function hydrateWithKws(replaced, queryText, maxKws, config) {
      var idx = 0;
      angular.forEach(keywordMapping(queryText, maxKws), function(queryTerm) {
        var regex = new RegExp('#\\$keyword' + (idx + 1) + '(.*?)##', 'g');
        if (queryTerm !== null) {
          queryTerm = encode(queryTerm, config);
          replaced = replaced.replace(regex, queryTerm);
        }
        idx += 1;
      });
      return replaced;
    }

    function hydrate(template, queryText, config) {
      if (!config) {
        config = defaultConfig;
      }

      if (queryText === null || angular.isUndefined(queryText)) {
        return template;
      }

      var replaced  = template.replace(/#\$query##/g, encode(queryText, config));
      var maxKws = getMaxKws(template, config);
      replaced = hydrateWithKws(replaced, queryText, maxKws, config);
      replaced = hydrateWithKwDefaults(replaced, config);

      return replaced;
    }
  });

'use strict';

// Executes a solr search and returns
// a set of solr documents
angular.module('o19s.splainer-search')
  .service('searchSvc', [
    'SolrSearcherFactory',
    'EsSearcherFactory',
    'activeQueries',
    'defaultSolrConfig',
    function searchSvc(
      SolrSearcherFactory,
      EsSearcherFactory,
      activeQueries,
      defaultSolrConfig
    ) {
      var svc = this;

      // PRE and POST strings, can't just use HTML
      // because Solr doesn't appear to support escaping
      // XML/HTML tags in the content. So we do this stupid thing
      svc.HIGHLIGHTING_PRE    = 'aouaoeuCRAZY_STRING!8_______';
      svc.HIGHLIGHTING_POST   = '62362iueaiCRAZY_POST_STRING!_______';

      this.configFromDefault = function() {
        return angular.copy(defaultSolrConfig);
      };

      this.createSearcherFromSettings = function(settings, queryText, searchEngine) {
        return this.createSearcher(
          settings.createFieldSpec().fieldList(),
          settings.url,
          settings.selectedTry.args,
          queryText,
          {
            version: settings.version,
          },
          searchEngine
        );
      };

      this.createSearcher = function (fieldList, url, args, queryText, config, searchEngine) {
        if ( searchEngine === undefined ) {
          searchEngine = 'solr';
        }

        var options = {
          fieldList:      fieldList,
          url:            url,
          args:           args,
          queryText:      queryText,
          config:         config,
          type:           searchEngine
        };

        var searcher;

        if ( searchEngine === 'solr') {
          options.HIGHLIGHTING_PRE  = svc.HIGHLIGHTING_PRE;
          options.HIGHLIGHTING_POST = svc.HIGHLIGHTING_POST;

          searcher = new SolrSearcherFactory(options);
        } else if ( searchEngine === 'es') {
          searcher = new EsSearcherFactory(options);
        }

        return searcher;
      };

      this.activeQueries = function() {
        return activeQueries.count;
      };
    }
  ]);

'use strict';

// Explains that exist below the match level
// these have a lot to do with the similarity implementation used by Solr/Lucene
// Here we implement default similarity, we will need to split this out for
// more similarity types (ie sweet spot, bm25) as needed
angular.module('o19s.splainer-search')
  .service('simExplainSvc', [
    function explainSvc() {

      this.DefaultSimilarityMatch = function(children) {
        var infl = children;
        if (children.length === 1 && children[0].explanation().startsWith('Score')) {
          infl = children[0].children;
        }

        this.fieldWeight = null;
        this.queryWeight = null;
        var match = this;
        angular.forEach(infl, function(child) {
          if (child.explanation() === 'Field Weight') {
            match.fieldWeight = child;
          } else if (child.explanation() === 'Query Weight') {
            match.queryWeight = child;
          }
        });

        this.formulaStr = function() {
          return 'TF=' + this.fieldWeight.tf().contribution() +
                 ' * IDF=' + this.fieldWeight.idf().contribution();
        };
      };

      var tfIdfable = function(explain) {
        var tfExpl = null;
        var idfExpl = null;
        angular.forEach(explain.children, function(child) {
          if (child.explanation().startsWith('Term')) {
            tfExpl = child;
          } else if (child.explanation().startsWith('IDF')) {
            idfExpl = child;
          }
        });

        explain.tf = function() {
          return tfExpl;
        };

        explain.idf = function() {
          return idfExpl;
        };
        return explain;
      };

      this.ScoreExplain = function() {
        this.realExplanation = 'Score';
      };

      this.FieldWeightExplain = function() {
        this.realExplanation = 'Field Weight';
        tfIdfable(this);

        /*this.fieldNorm = function() {
        };*/
      };

      this.QueryWeightExplain = function() {
        this.realExplanation = 'Query Weight';
        tfIdfable(this);
      };

      // For default similarity, tf in the score is actually
      // is sqrt(termFreq) where termFreq is the frequency of
      // a term in a document.
      this.DefaultSimTfExplain = function() {

        // Should have a single child with actual term frequency
        // Notes TODO:
        // 1. For strict phrase queries, ie "one two" this is
        //    phraseFreq, not a big deal just labeling
        // 2. For sloppy phrase queries gets more complicated,
        //     sloppyFreq is (1 / (distance + 1))
        //      where distance min distance in doc between "one ... two"
        //      for every set of phrases in document
        var termFreq = this.children[0].contribution();
        this.realExplanation = 'Term Freq Score (' + termFreq + ')';
      };

      // For default similarity, IDF of the term being searched
      // in the case of phrase queries, this is a sum of
      // all the members of the phrase.
      //
      // TODO -- the underlying idf for each member of a phrase
      // does not identify the term corresponding to that idf,
      // Lucene patch?
      //
      // The formula for IDF in default similarity is
      //  1 + log( numDocs / (docFreq + 1))
      //
      // or taken the idf explanation:
      //   idf(docFreq=4743, maxDocs=20148)
      // in python:
      // >> 1 + log(20148.0 / (4753 + 1))
      //
      this.DefaultSimIdfExplain = function(explJson) {
        var desc = explJson.description;
        if (this.children.length > 1 && desc.hasSubstr('sum of:')) {
          // then each child is an idf explain
          this.realExplanation = 'IDF Score';
          this.influencers = function() {
            return this.children;
          };
        }
        else {
          var idfRegex = /idf\(docFreq=(\d+),.*maxDocs=(\d+)\)/;
          var matches = desc.match(idfRegex);
          if (matches !== null && matches.length > 1) {
            /*var docFreq = parseInt(matches[1], 10);
            var maxDocs = parseInt(matches[2], 10);*/
            this.realExplanation = 'IDF Score';
          }
          else {
            this.realExplanation = desc;
          }
        }
      };
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('solrExplainExtractorSvc', [
    'normalDocsSvc',
    function solrExplainExtractorSvc(normalDocsSvc) {
      var self = this;

      // Functions
      self.getOverridingExplain   = getOverridingExplain;
      self.docsWithExplainOther   = docsWithExplainOther;

      function getOverridingExplain(doc, fieldSpec, explainData) {
        var idFieldName = fieldSpec.id;
        var id          = doc[idFieldName];

        if (id && explainData && explainData.hasOwnProperty(id)) {
          return explainData[id];
        }

        return null;
      }

      function docsWithExplainOther(docs, fieldSpec, explainData) {
        var parsedDocs = [];

        angular.forEach(docs, function(doc) {
          var overridingExplain = self.getOverridingExplain(doc, fieldSpec, explainData);
          var normalDoc         = normalDocsSvc.createNormalDoc(fieldSpec, doc, overridingExplain);

          parsedDocs.push(normalDoc);
        });

        return parsedDocs;
      }
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('solrSearcherPreprocessorSvc', [
    'solrUrlSvc',
    'defaultSolrConfig',
    'queryTemplateSvc',
    function solrSearcherPreprocessorSvc(solrUrlSvc, defaultSolrConfig, queryTemplateSvc) {
      var self      = this;
      self.prepare  = prepare;

      var withoutUnsupported = function (argsToUse, sanitize) {
        var argsRemoved = angular.copy(argsToUse);
        if (sanitize === true) {
          solrUrlSvc.removeUnsupported(argsRemoved);
        }
        return argsRemoved;
      };

      // the full URL we'll use to call Solr
      var buildCallUrl = function(searcher) {
        var fieldList = searcher.fieldList;
        var url       = searcher.url;
        var config    = searcher.config;
        var args      = withoutUnsupported(searcher.args, config.sanitize);
        var queryText = searcher.queryText;

        args.fl = (fieldList === '*') ? '*' : [fieldList.join(' ')];
        args.wt = ['json'];

        if (config.debug) {
          args.debug = ['true'];
          args['debug.explain.structured'] = ['true'];
        }

        if (config.highlight) {
          args.hl                 = ['true'];
          args['hl.fl']           = args.fl;
          args['hl.simple.pre']   = [searcher.HIGHLIGHTING_PRE];
          args['hl.simple.post']  = [searcher.HIGHLIGHTING_POST];
        }

        if (config.escapeQuery) {
          queryText = solrUrlSvc.escapeUserQuery(queryText);
        }

        if ( !args.rows ) {
          args.rows = [config.numberOfRows];
        }

        var baseUrl = solrUrlSvc.buildUrl(url, args);
        baseUrl = queryTemplateSvc.hydrate(baseUrl, queryText, {encodeURI: true, defaultKw: '""'});

        return baseUrl;
      };

      function prepare (searcher) {
        if (searcher.config === undefined) {
          searcher.config = defaultSolrConfig;
        } else {
          // make sure config params that weren't passed through are set from
          // the default config object.
          searcher.config = angular.merge({}, defaultSolrConfig, searcher.config);
        }

        searcher.callUrl = buildCallUrl(searcher);

        searcher.linkUrl = searcher.callUrl.replace('wt=json', 'wt=xml');
        searcher.linkUrl = searcher.linkUrl + '&indent=true&echoParams=all';
      }
    }
  ]);

'use strict';

angular.module('o19s.splainer-search')
  .service('solrUrlSvc', [
    function solrUrlSvc() {

      /* private method fixURLProtocol
       * add 'http://' to the begining of the url if no protocol was
       * specified
       * */
      var protocolRegex = /^https{0,1}\:/;
      function fixURLProtocol(url) {
        if (!protocolRegex.test(url)) {
          url = 'http://' + url;
        }
        return url;
      }

      this.buildUrl = function(url, urlArgs) {
        url = fixURLProtocol(url);
        var baseUrl = url + '?';
        baseUrl += this.formatSolrArgs(urlArgs);
        return baseUrl;
      };

      /* Given arguments of the form {q: ['*:*'], fq: ['title:foo', 'text:bar']}
       * turn into string suitable for URL query param q=*:*&fq=title:foo&fq=text:bar
       *
       * */
      this.formatSolrArgs = function(argsObj) {
        var rVal = '';

        angular.forEach(argsObj, function(values, param) {
          if ( angular.isString(values) ) {
            rVal += param + '=' + values + '&';
          } else {
            angular.forEach(values, function(value) {
              rVal += param + '=' + value + '&';
            });
          }
        });

        // percentages need to be escaped before url escaping
        // but only if it is not part of a percent encoding character
        // https://en.wikipedia.org/wiki/Percent-encoding
        rVal = rVal.replace(/\%(?!(2|3|4|5))/g, '%25');

        return rVal.slice(0, -1); // take out last & or trailing ? if no args
      };

      /* Given string of the form [?]q=*:*&fq=title:foo&fq=title:bar
       * turn into object of the form:
       * {q:['*:*'], fq:['title:foo', 'title:bar']}
       *
       * */
      this.parseSolrArgs = function(argsStr) {
        var splitUp = argsStr.split('?');
        if (splitUp.length === 2) {
          argsStr = splitUp[1];
        }
        var vars = argsStr.split('&');
        var rVal = {};
        angular.forEach(vars, function(qVar) {
          var nameAndValue = qVar.split(/=(.*)/);
          if (nameAndValue.length >= 2) {
            var name  = nameAndValue[0];
            var value = nameAndValue[1];
            var decodedValue = value;
            try {
              decodedValue = decodeURIComponent(value);
            } catch (URIError) { // expected if the string is not actually URL encoded has a stray %, ie mm=50%
              console.warn('Parameter ' + value + ' could not be URI decoded, this might be ok');
            }
            if (!rVal.hasOwnProperty(name)) {
              rVal[name] = [decodedValue];
            } else {
              rVal[name].push(decodedValue);
            }
          }
        });
        return rVal;
      };

      /* Parse a Solr URL of the form [/]solr/[collectionName]/[requestHandler]
       * return object with {collectionName: <collectionName>, requestHandler: <requestHandler>}
       * return null on failure to parse as above solr url
       * */
      this.parseSolrPath = function(pathStr) {
        if (pathStr.startsWith('/')) {
          pathStr = pathStr.slice(1);
        }

        var pathComponents = pathStr.split('/');
        var pcLen = pathComponents.length;
        if (pcLen >= 2) {

          var reqHandler = pathComponents[pcLen - 1];
          var collection = pathComponents[pcLen - 2];
          return {requestHandler: reqHandler, collectionName: collection};
        }
        return null;
      };

      /* Parse a Sor URL of the form [http|https]://[host]/solr/[collectionName]/[requestHandler]?[args]
       * return null on failure to parse
       * */
      this.parseSolrUrl = function(solrReq) {
        solrReq = fixURLProtocol(solrReq);
        var parseUrl = function(url) {
          // this is the crazy way you parse URLs in JS who am I to question the wisdom
          var a = document.createElement('a');
          a.href = url;
          return a;
        };

        var parsedUrl = parseUrl(solrReq);
        parsedUrl.solrArgs = this.parseSolrArgs(parsedUrl.search);
        var pathParsed = this.parseSolrPath(parsedUrl.pathname);
        if (pathParsed) {
          parsedUrl.collectionName = pathParsed.collectionName;
          parsedUrl.requestHandler = pathParsed.requestHandler;
        } else {
          return null;
        }
        var solrEndpoint = function() {
          return parsedUrl.protocol + '//' + parsedUrl.host + parsedUrl.pathname;
        };

        parsedUrl.solrEndpoint = solrEndpoint;
        return parsedUrl;

      };

      /*optionally escape user query text, ie
       * q=punctuation:: clearly can't search for the
       * term ":" (colon) because colon has meaning in the query syntax
       * so instead, you've got to search for
       * q=punctuation:\:
       * */
      this.escapeUserQuery = function(queryText) {
        var escapeChars = ['+', '-', '&', '!', '(', ')', '[', ']',
                           '{', '}', '^', '"', '~', '*', '?', ':', '\\'];
        var regexp = new RegExp('(\\' + escapeChars.join('|\\') + ')', 'g');
        var symsRepl = queryText.replace(regexp, '\\$1');
        var regexpAnd = new RegExp('(^|\\s+)(and)($|\\s+)', 'g');
        var andRepl = symsRepl.replace(regexpAnd, '$1\\\\$2$3');
        var regexOr = new RegExp('(^|\\s+)(or)($|\\s+)', 'g');
        var orRepl = andRepl.replace(regexOr, '$1\\\\$2$3');
        return orRepl;
      };

      /* This method is a bit tied to how the searchSvc behaves, but
       * as this module is probably what you're using to chop up a user's SolrURL
       * its placed here
       *
       * It strips arguments out that are not supported by searchSvc and
       * generally interfere with its operation (ie fl, facet, etc). searchSvc
       * removes these itself, but this is placed here for convenience to remove
       * from user input (ie an fl may confuse the user when fl is actually supplied
       * elsewhere)
       * */
      this.removeUnsupported = function(solrArgs) {
          var warnings = {};
          // Stuff I think we can safely remove without warning the user
          delete solrArgs['json.wrf'];
          delete solrArgs.facet;
          delete solrArgs['facet.field'];
          delete solrArgs.fl;
          delete solrArgs.hl;
          delete solrArgs['hl.simple.pre'];
          delete solrArgs['hl.simple.post'];
          delete solrArgs.wt;
          delete solrArgs.debug;

          // Unsupported stuff to remove and provide a friendly warning
          return warnings;
      };
    }
  ]);

'use strict';

if (typeof String.prototype.startsWith !== 'function') {
  // see below for better implementation!
  String.prototype.startsWith = function (str) {
    return this.indexOf(str) === 0;
  };
}

if (typeof String.prototype.hasSubstr !== 'function') {
  String.prototype.hasSubstr = function(str) {
    return this.indexOf(str) !== -1;
  };
}

if (typeof String.prototype.endsWith !== 'function') {
  String.prototype.endsWith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
  };
}

'use strict';

angular.module('o19s.splainer-search')
  .service('transportSvc', [
    'HttpPostTransportFactory',
    'HttpGetTransportFactory',
    'BulkTransportFactory',
    function transportSvc(
      HttpPostTransportFactory,
      HttpGetTransportFactory,
      BulkTransportFactory
    ) {
      var self = this;

      // functions
      self.getTransport = getTransport;

      var bulkTransport     = new BulkTransportFactory({});
      var httpPostTransport = new HttpPostTransportFactory({});
      var httpGetTransport  = new HttpGetTransportFactory({});

      function getTransport(options) {
        if (options.apiMethod === 'bulk') {
          return bulkTransport;
        } else if (options.apiMethod === 'get') {
          return httpGetTransport;
        } else {
          return httpPostTransport;
        }
      }
    }
  ]);

'use strict';

/*
 * Basic vector operations used by explain svc
 *
 * */
angular.module('o19s.splainer-search')
  .service('vectorSvc', [
    function vectorSvc() {

      var SparseVector = function() {
        this.vecObj = {};

        var asStr = '';
        var setDirty = function() {
          asStr = '';
        };

        this.set = function(key, value) {
          this.vecObj[key] = value;
          setDirty();
        };

        this.get = function(key) {
          if (this.vecObj.hasOwnProperty(key)) {
            return this.vecObj[key];
          }
          return undefined;
        };

        this.add = function(key, value) {
          if (this.vecObj.hasOwnProperty(key)) {
            this.vecObj[key] += value;
          }
          else {
            this.vecObj[key] = value;
          }
          setDirty();
        };

        this.toStr = function() {
          // memoize the toStr conversion
          if (asStr === '') {
            // sort
            var sortedL = [];
            angular.forEach(this.vecObj, function(value, key) {
              sortedL.push([key, value]);
            });
            sortedL.sort(function(lhs, rhs) {return rhs[1] - lhs[1];});
            angular.forEach(sortedL, function(keyVal) {
              asStr += (keyVal[1] + ' ' + keyVal[0] + '\n');
            });
          }
          return asStr;
        };

      };

      this.create = function() {
        return new SparseVector();
      };

      this.add = function(lhs, rhs) {
        var rVal = this.create();
        angular.forEach(lhs.vecObj, function(value, key) {
          rVal.set(key, value);
        });
        angular.forEach(rhs.vecObj, function(value, key) {
          rVal.set(key, value);
        });
        return rVal;
      };

      this.sumOf = function(lhs, rhs) {
        var rVal = this.create();
        angular.forEach(lhs.vecObj, function(value, key) {
          rVal.add(key, value);
        });
        angular.forEach(rhs.vecObj, function(value, key) {
          rVal.add(key, value);
        });
        return rVal;
      };


      this.scale = function(lhs, scalar) {
        var rVal = this.create();
        angular.forEach(lhs.vecObj, function(value, key) {
          rVal.set(key, value * scalar);
        });
        return rVal;
      };
    }
  ]);

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('BulkTransportFactory', [
      'TransportFactory',
      '$http',
      '$q',
      '$timeout',
      '$log',
      BulkTransportFactory
    ]);


  function BulkTransportFactory(TransportFactory, $http, $q, $timeout, $log) {
    var Transport = function(options) {
      TransportFactory.call(this, options);
      this.batchSender = null;
    };

    Transport.prototype = Object.create(TransportFactory.prototype);
    Transport.prototype.constructor = Transport;

    Transport.prototype.query = query;



    var BatchSender = function(url, headers) {
      /* Use Elasticsearch's _msearch API to send
       * batches of searches one batch at a time
       * */

      var requestConfig = {headers: headers};
      var self = this;
      self.enqueue = enqueue;
      self.url = getUrl;
      var queue = [];
      var pendingHttp = null;

      function finishBatch(batchSize) {
        pendingHttp = null;
        queue = queue.slice(batchSize);
      }

      function multiSearchSuccess(httpResp) {
        // Examine the responses and dequeue the corresponding
        // searches
        var bulkHttpResp = httpResp.data;
        if (bulkHttpResp.hasOwnProperty('responses'))  {
          var respLen = bulkHttpResp.responses.length;
          dequeuePendingSearches(bulkHttpResp);
          finishBatch(respLen);
        } else {
          multiSearchFailed(bulkHttpResp);
        }
      }

      function multiSearchFailed(bulkHttpResp) {
        // Handle HTTP failure, which should fail all in flight searches
        var numInFlight = 0;
        angular.forEach(queue, function(pendingQuery) {
          if (pendingQuery.inFlight) {
            pendingQuery.defered.reject(bulkHttpResp);
            numInFlight++;
          }
        });
        finishBatch(numInFlight);
      }

      function buildMultiSearch() {
        // Batch queued searches into one message using MultiSearch API
        // https://www.elastic.co/guide/en/elasticsearch/reference/1.4/search-multi-search.html
        var sharedHeader = JSON.stringify({});
        var queryLines = [];
        angular.forEach(queue, function(pendingQuery) {
          queryLines.push(sharedHeader);
          pendingQuery.inFlight = true;
          queryLines.push(JSON.stringify(pendingQuery.payload));
        });
        var data = queryLines.join('\n') + '\n';
        return data;
      }

      function dequeuePendingSearches(bulkHttpResp) {
        // Examine the responses and dequeue the corresponding
        // searches
        var queueIdx = 0;
        angular.forEach(bulkHttpResp.responses, function(resp) {
          var currRequest = queue[queueIdx];
          if (resp.hasOwnProperty('error')) {
            currRequest.defered.reject(resp);
            // individual query failure
          } else {
            // make the response look like standard response
            currRequest.defered.resolve({'data': resp});
          }

          queueIdx++;
        });
      }

      function sendMultiSearch() {
        if (!pendingHttp && queue.length > 0) {
          // Implementation of Elasticsearch's _msearch ("Multi Search") API
          var payload = buildMultiSearch();
          pendingHttp = $http.post(url, payload, requestConfig);
          pendingHttp.then(multiSearchSuccess, multiSearchFailed)
            .catch(function(response) {
              $log.debug('Failed to do multi search');
              return response;
            });
        }
      }

      function enqueue(query) {
        var defered = $q.defer();

        var pendingQuery = {
          defered: defered,
          inFlight: false,
          payload: query,
        };
        queue.push(pendingQuery);
        return defered.promise;
      }

      function timerTick() {
        sendMultiSearch();
        $timeout(timerTick, 100);
      }

      function getUrl() {
        return url;
      }

      $timeout(timerTick, 100);


    };

    function query(url, payload, headers) {
      var self = this;
      if (!self.batchSender) {
        self.batchSender = new BatchSender(url, headers);
      }
      else if (self.batchSender.url() !== url) {
        self.batchSender = new BatchSender(url, headers);
      }
      return self.batchSender.enqueue(payload);

    }

    return Transport;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('DocFactory', [DocFactory]);

  function DocFactory() {
    var Doc = function(doc, opts) {
      var self        = this;

      angular.copy(doc, self);

      self.doc             = doc;

      self.groupedBy       = groupedBy;
      self.group           = group;
      self.options         = options;
      self.version         = version;
      self.fieldsAttrName  = fieldsAttrName;
      self.fieldsProperty  = fieldsProperty;

      function groupedBy () {
        if (opts.groupedBy === undefined) {
          return null;
        } else {
          return opts.groupedBy;
        }
      }

      function options() {
        return opts;
      }

      function group () {
        if (opts.group === undefined) {
          return null;
        } else {
          return opts.group;
        }
      }

      function version () {
        if (opts.version === undefined) {
          return null;
        } else {
          return opts.version;
        }
      }

      function fieldsAttrName() {
        return '_source';
      }

      function fieldsProperty() {
        return self[self.fieldsAttrName()];
      }
    };

    // Return factory object
    return Doc;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('EsDocFactory', [
      'esUrlSvc',
      'DocFactory',
      EsDocFactory
    ]);

  function EsDocFactory(esUrlSvc, DocFactory) {
    var Doc = function(doc, options) {
      DocFactory.call(this, doc, options);

      var self = this;

      angular.forEach(self.fieldsProperty(), function(fieldValue, fieldName) {
        if ( fieldValue !== null && fieldValue.constructor === Array && fieldValue.length === 1 ) {
          self[fieldName] = fieldValue[0];
        } else {
          self[fieldName] = fieldValue;
        }
      });

      // Delete the highlight snippet because the normalized doc expect
      // `highlight` to be a function, not an object.
      // The highlight snippet is still available from `self.doc.highlight`.
      delete self.highlight;
    };

    Doc.prototype = Object.create(DocFactory.prototype);
    Doc.prototype.constructor = Doc; // Reset the constructor

    Doc.prototype._url       = _url;
    Doc.prototype.explain    = explain;
    Doc.prototype.snippet    = snippet;
    Doc.prototype.source     = source;
    Doc.prototype.highlight  = highlight;

    function _url () {
      /*jslint validthis:true*/
      var self  = this;
      var doc   = self.doc;
      var esurl = self.options().url;

      var uri = esUrlSvc.parseUrl(esurl);
      return esUrlSvc.buildDocUrl(uri, doc);
    }

    function explain () {
      /*jslint validthis:true*/
      var self = this;
      return self.options().explDict;
    }

    function snippet (docId, fieldName) {
      /*jslint validthis:true*/
      var self = this;

      if (self.doc.hasOwnProperty('highlight')) {
        var docHls = self.doc.highlight;
        if (docHls.hasOwnProperty(fieldName)) {
          return docHls[fieldName];
        }
      }
      return null;
    }

    function source () {
      /*jslint validthis:true*/
      var self = this;

      // Usually you would return _source, but since we are specifying the
      // fields to display, ES only returns those specific fields.
      // And we are assigning the fields to the doc itself in this case.
      var src = {};
      angular.forEach(self, function(value, field) {
        if (!angular.isFunction(value)) {
          src[field] = value;
        }
      });
      delete src.doc;
      delete src.fields;
      delete src._explanation;
      delete src.highlight;
      return src;
    }

    function highlight (docId, fieldName, preText, postText) {
      /*jslint validthis:true*/
      var self        = this;
      var fieldValue  = self.snippet(docId, fieldName);

      if (fieldValue) {
        var newValue = [];
        angular.forEach(fieldValue, function (value) {
          // Doing the naive thing and assuming that the highlight tags
          // were not overridden in the query DSL.
          var preRegex  = new RegExp('<em>', 'g');
          var hlPre     = value.replace(preRegex, preText);
          var postRegex = new RegExp('</em>', 'g');

          newValue.push(hlPre.replace(postRegex, postText));
        });

        return newValue;
      } else {
        return null;
      }
    }

    return Doc;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('EsSearcherFactory', [
      '$http',
      '$q',
      '$log',
      'EsDocFactory',
      'activeQueries',
      'esSearcherPreprocessorSvc',
      'esUrlSvc',
      'SearcherFactory',
      'transportSvc',
      EsSearcherFactory
    ]);

  function EsSearcherFactory(
    $http, $q, $log,
    EsDocFactory,
    activeQueries,
    esSearcherPreprocessorSvc, esUrlSvc,
    SearcherFactory,
    transportSvc
  ) {

    var Searcher = function(options) {
      SearcherFactory.call(this, options, esSearcherPreprocessorSvc);
    };

    Searcher.prototype = Object.create(SearcherFactory.prototype);
    Searcher.prototype.constructor = Searcher; // Reset the constructor


    Searcher.prototype.addDocToGroup    = addDocToGroup;
    Searcher.prototype.pager            = pager;
    Searcher.prototype.search           = search;
    Searcher.prototype.explainOther     = explainOther;
    Searcher.prototype.explain          = explain;
    Searcher.prototype.majorVersion     = majorVersion;


    function addDocToGroup (groupedBy, group, solrDoc) {
      /*jslint validthis:true*/
      var self = this;

      if (!self.grouped.hasOwnProperty(groupedBy)) {
        self.grouped[groupedBy] = [];
      }

      var found = null;
      angular.forEach(self.grouped[groupedBy], function(groupedDocs) {
        if (groupedDocs.value === group && !found) {
          found = groupedDocs;
        }
      });

      if (!found) {
        found = {docs:[], value:group};
        self.grouped[groupedBy].push(found);
      }

      found.docs.push(solrDoc);
    }

    // return a new searcher that will give you
    // the next page upon search(). To get the subsequent
    // page, call pager on that searcher ad infinidum
    function pager () {
      /*jslint validthis:true*/
      var self      = this;
      var pagerArgs = { from: 0, size: self.config.numberOfRows };
      var nextArgs  = angular.copy(self.args);

      if (nextArgs.hasOwnProperty('pager') && nextArgs.pager !== undefined) {
        pagerArgs = nextArgs.pager;
      } else if (self.hasOwnProperty('pagerArgs') && self.pagerArgs !== undefined) {
        pagerArgs = self.pagerArgs;
      }

      if (pagerArgs.hasOwnProperty('from')) {
        pagerArgs.from = parseInt(pagerArgs.from) + pagerArgs.size;

        if (pagerArgs.from >= self.numFound) {
          return null; // no more results
        }
      } else {
        pagerArgs.from = pagerArgs.size;
      }

      nextArgs.pager      = pagerArgs;
      var options         = {
        args:       nextArgs,
        config:     self.config,
        fieldList:  self.fieldList,
        queryText:  self.queryText,
        type:       self.type,
        url:        self.url,
      };

      var nextSearcher = new Searcher(options);

      return nextSearcher;
    }

    // search (execute the query) and produce results
    // to the returned future
    function search () {
      /*jslint validthis:true*/
      var self      = this;
      var uri       = esUrlSvc.parseUrl(self.url);
      var apiMethod = self.config.apiMethod;

      if ( esUrlSvc.isBulkCall(uri) ) {
        apiMethod = 'bulk';
      }

      if (apiMethod === 'get' ) {
        var fieldList = self.fieldList.join(',');

        if ( 5 <= self.majorVersion() ) {
          /*jshint camelcase: false */
          esUrlSvc.setParams(uri, {
            _source:       fieldList,
          });
        } else {
          esUrlSvc.setParams(uri, {
            _source: fieldList,
          });
        }
      }

      var url       = esUrlSvc.buildUrl(uri);
      var transport = transportSvc.getTransport({apiMethod: apiMethod});

      var queryDslWithPagerArgs = angular.copy(self.queryDsl);
      if (self.pagerArgs) {
        queryDslWithPagerArgs.from = self.pagerArgs.from;
        queryDslWithPagerArgs.size = self.pagerArgs.size;
      }

      self.inError  = false;

      var getExplData = function(doc) {
        if (doc.hasOwnProperty('_explanation')) {
          return doc._explanation;
        }
        else {
          return null;
        }
      };

      var getHlData = function(doc) {
        if (doc.hasOwnProperty('highlight')) {
          return doc.highlight;
        } else {
          return null;
        }
      };

      var formatError = function(msg) {
          var errorMsg = '';
          if (msg) {
            if (msg.status >= 400) {
              errorMsg = 'HTTP Error: ' + msg.status + ' ' + msg.statusText;
            }
            if (msg.status > 0) {
              if (msg.hasOwnProperty('data') && msg.data) {

                if (msg.data.hasOwnProperty('error')) {
                  errorMsg += '\n' + JSON.stringify(msg.data.error, null, 2);
                }
                if (msg.data.hasOwnProperty('_shards')) {
                  angular.forEach(msg.data._shards.failures, function(failure) {
                    errorMsg += '\n' + JSON.stringify(failure, null, 2);
                  });
                }

              }
            }
            else if (msg.status === -1 || msg.status === 0) {
              errorMsg +=  'Network Error! (host not found)\n';
              errorMsg += '\n';
              errorMsg +=  'or CORS needs to be configured for your Elasticsearch\n';
              errorMsg +=  '\n';
              errorMsg +=  'Enable CORS in elasticsearch.yml:\n';
              errorMsg += '\n';
              errorMsg += 'http.cors.allow-origin: "/https?:\\\\/\\\\/(.*?\\\\.)?(quepid\\\\.com|splainer\\\\.io)/"\n';
              errorMsg += 'http.cors.enabled: true\n';
            }
            msg.searchError = errorMsg;
          }
          return msg;
      };

      // Build URL with params if any
      // Eg. without params:  /_search
      // Eg. with params:     /_search?size=5&from=5
      //esUrlSvc.setParams(uri, self.pagerArgs);

      var headers = esUrlSvc.getHeaders(uri);

      activeQueries.count++;
      return transport.query(url, queryDslWithPagerArgs, headers)
        .then(function success(httpConfig) {
          var data = httpConfig.data;
          activeQueries.count--;
          self.numFound = data.hits.total;

          var parseDoc = function(doc, groupedBy, group) {
            var explDict  = getExplData(doc);
            var hlDict    = getHlData(doc);

            var options = {
              groupedBy:          groupedBy,
              group:              group,
              fieldList:          self.fieldList,
              url:                self.url,
              explDict:           explDict,
              hlDict:             hlDict,
              version:            self.majorVersion(),
            };

            return new EsDocFactory(doc, options);
          };

          angular.forEach(data.hits.hits, function(hit) {
            var doc = parseDoc(hit);
            self.docs.push(doc);
          });

          if ( angular.isDefined(data._shards) && data._shards.failed > 0 ) {
            return $q.reject(formatError(httpConfig));
          }
        }, function error(msg) {
          activeQueries.count--;
          self.inError = true;
          return $q.reject(formatError(msg));
        })
        .catch(function(response) {
          $log.debug('Failed to execute search');
          return $q.reject(response);
        });
    } // end of search()

    function explainOther (otherQuery) {
      /*jslint validthis:true*/
      var self = this;

      var otherSearcherOptions = {
        fieldList:  self.fieldList,
        url:        self.url,
        args:       self.args,
        queryText:  otherQuery,
        config:     {
          apiMethod:    'get',
          numberOfRows: self.config.numberOfRows,
          version:      self.config.version,
        },
        type:       self.type,
      };

      if ( angular.isDefined(self.pagerArgs) && self.pagerArgs !== null ) {
        otherSearcherOptions.args.pager = self.pagerArgs;
      }

      var otherSearcher = new Searcher(otherSearcherOptions);

      return otherSearcher.search()
        .then(function() {
          self.numFound = otherSearcher.numFound;

          var defer     = $q.defer();
          var promises  = [];
          var docs      = [];

          angular.forEach(otherSearcher.docs, function(doc) {
            var promise = self.explain(doc)
              .then(function(parsedDoc) {
                docs.push(parsedDoc);
              });

            promises.push(promise);
          });

          $q.all(promises)
            .then(function () {
              self.docs = docs;
              defer.resolve();
            });

          return defer.promise;
        }).catch(function(response) {
          $log.debug('Failed to run explainOther');
          return response;
        });
    } // end of explainOther()

    function explain(doc) {
      /*jslint validthis:true*/
      var self    = this;
      var uri     = esUrlSvc.parseUrl(self.url);
      var url     = esUrlSvc.buildExplainUrl(uri, doc);
      var headers = esUrlSvc.getHeaders(uri);

      return $http.post(url, { query: self.queryDsl.query }, {headers: headers})
        .then(function(response) {
          var explDict  = {
            match:        response.data.matched,
            explanation:  response.data.explanation,
            description:  response.data.explanation.description,
            value:        response.data.explanation.value,
          };

          var options = {
            fieldList: self.fieldList,
            url:       self.url,
            explDict:  explDict,
          };

          return new EsDocFactory(doc, options);
        }).catch(function(response) {
          $log.debug('Failed to run explain');
          return response;
        });
    } // end of explain()

    function majorVersion() {
      var self = this;

      if ( angular.isDefined(self.config) &&
        angular.isDefined(self.config.version) &&
        self.config.version !== null &&
        self.config.version !== ''
      ) {
        return parseInt(self.config.version.split('.')[0]);
      } else {
        return null;
      }
    }

    // Return factory object
    return Searcher;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('HttpGetTransportFactory', [
      'TransportFactory',
      '$http',
      HttpGetTransportFactory
    ]);

  function HttpGetTransportFactory(TransportFactory, $http) {
    var Transport = function(options) {
      TransportFactory.call(this, options);
    };

    Transport.prototype = Object.create(TransportFactory.prototype);
    Transport.prototype.constructor = Transport;

    Transport.prototype.query = query;

    function query(url, payload, headers) {
      var requestConfig = { headers: headers };
      return $http.get(url, requestConfig);
    }

    return Transport;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('HttpPostTransportFactory', [
      'TransportFactory',
      '$http',
      HttpPostTransportFactory
    ]);

  function HttpPostTransportFactory(TransportFactory, $http) {
    var Transport = function(options) {
      TransportFactory.call(this, options);
    };

    Transport.prototype = Object.create(TransportFactory.prototype);
    Transport.prototype.constructor = Transport;

    Transport.prototype.query = query;

    function query(url, payload, headers) {
      var requestConfig = {headers: headers};
      return $http.post(url, payload, requestConfig);
    }

    return Transport;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('ResolverFactory', [
      '$q',
      '$log',
      'searchSvc',
      'solrUrlSvc',
      'normalDocsSvc',
      ResolverFactory
    ]);

  function ResolverFactory($q, $log, searchSvc, solrUrlSvc, normalDocsSvc) {
    var Resolver = function(ids, settings, chunkSize) {
      var self        = this;

      self.settings   = settings;
      self.ids        = ids;
      self.docs       = [];
      self.args       = {};
      self.config     = {};
      self.queryText  = null;
      self.fieldSpec  = self.settings.createFieldSpec();
      self.chunkSize  = chunkSize;

      self.fetchDocs  = fetchDocs;

      if ( self.settings.searchEngine === undefined || self.settings.searchEngine === 'solr' ) {
        var escapeIds = function(ids) {
          var newIds = [];
          angular.forEach(ids, function(id) {
            newIds.push(solrUrlSvc.escapeUserQuery(id));
          });
          return newIds;
        };

        var allIdsLuceneQuery = self.fieldSpec.id + ':(';
        allIdsLuceneQuery += escapeIds(ids).join(' OR ');
        allIdsLuceneQuery += ')';
        self.queryText = allIdsLuceneQuery;

        self.args = {
          defType: ['lucene'],
          rows: [ids.length],
          q: ['#$query##']
        };
      } else if ( settings.searchEngine === 'es' ) {
        self.args = {
          'query': {
            'ids': {
              'values': ids
            }
          },
          size: ids.length
        };
      }

      self.config = {
        sanitize:     false,
        highlight:    false,
        debug:        false,
        escapeQuery:  false,
        numberOfRows: ids.length,
        version:      self.settings.version,
      };

      self.searcher = searchSvc.createSearcher(
        self.fieldSpec.fieldList(),
        self.settings.searchUrl,
        self.args,
        self.queryText,
        self.config,
        self.settings.searchEngine
      );

      function fetchDocs () {
        if ( self.chunkSize === undefined ) {
          return self.searcher.search()
            .then(function() {
              var newDocs = self.searcher.docs;
              self.docs.length = 0;
              var idsToDocs = {};
              angular.forEach(newDocs, function(doc) {
                var normalDoc = normalDocsSvc.createNormalDoc(self.fieldSpec, doc);
                idsToDocs[normalDoc.id] = normalDoc;
              });

              // Push either the doc from solr or a missing doc stub
              angular.forEach(ids, function(docId) {
                if (idsToDocs.hasOwnProperty(docId)) {
                  self.docs.push(idsToDocs[docId]);
                } else {
                  var placeholderTitle = 'Missing Doc: ' + docId;
                  var placeholderDoc = normalDocsSvc.createPlaceholderDoc(
                    docId,
                    placeholderTitle
                  );
                  self.docs.push(placeholderDoc);
                }
              });

              return self.docs;
            }).catch(function(response) {
              $log.debug('Failed to fetch docs');
              return response;
            });
        } else {
          var sliceIds = function(ids, chunkSize) {
            if (chunkSize > 0) {
              // chunkSize = chunkSize | 0;
              var slices = [];
              for (var i = 0; i < ids.length; i+= chunkSize) {
                slices.push(ids.slice(i, i + chunkSize));
              }
              return slices;
            }
          };

          var deferred = $q.defer();
          var promises = [];

          angular.forEach(sliceIds(ids, chunkSize), function(sliceOfIds) {
            var resolver = new Resolver(sliceOfIds, settings);
            promises.push(resolver.fetchDocs());
          });

          $q.all(promises)
            .then(function(docsChunk) {
              self.docs = self.docs.concat.apply(self.docs, docsChunk);
              deferred.resolve();
            }).catch(function(response) {
              $log.debug('Failed to fetch docs');
              return response;
            });

          return deferred.promise;
        }
      }
    };

    // Return factory object
    return Resolver;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('SearcherFactory', [SearcherFactory]);

  function SearcherFactory() {
    var Searcher = function(options, preprocessor) {
      var self                = this;

      self.fieldList          = options.fieldList;
      self.url                = options.url;
      self.args               = options.args;
      self.queryText          = options.queryText;
      self.config             = options.config;
      self.type               = options.type;

      self.docs               = [];
      self.grouped            = {};
      self.numFound           = 0;
      self.inError            = false;
      self.othersExplained    = {};

      self.HIGHLIGHTING_PRE   = options.HIGHLIGHTING_PRE;
      self.HIGHLIGHTING_POST  = options.HIGHLIGHTING_POST;

      preprocessor.prepare(self);
    };

    // Return factory object
    return Searcher;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('SettingsValidatorFactory', [
      'searchSvc',
      SettingsValidatorFactory
    ]);

  function SettingsValidatorFactory(searchSvc) {
    var Validator = function(settings) {
      var self  = this;

      self.searchUrl    = settings.searchUrl;
      self.searchEngine = settings.searchEngine;
      self.version      = settings.version;

      self.searcher = null;
      self.fields   = [];
      self.idFields = [];

      self.setupSearcher  = setupSearcher;
      self.validateUrl    = validateUrl;

      self.setupSearcher();

      function setupSearcher () {
        var args    = { };
        var fields  = '*';

        if ( self.searchEngine === 'solr' ) {
          args = { q: ['*:*'] };
        } else if ( self.searchEngine === 'es' ) {
          fields = null;
        }

        self.searcher = searchSvc.createSearcher(
          fields,
          self.searchUrl,
          args,
          '',
          {
            version: self.version,
          },
          self.searchEngine
        );
      }

      function sourceDoc(doc) {
        if ( self.searchEngine === 'solr' ) {
          return doc.doc;
        } else if (self.searchEngine === 'es') {
          return doc.doc._source;
        }
      }

      function intersection(a, b) {
        var intersect = a.filter(function(aVal) {
          return b.indexOf(aVal) !== -1;
        });
        return intersect;
      }

      function updateCandidateIds(candidateIds, attributes) {
        if (angular.isUndefined(candidateIds)) {
          return attributes;
        }
        // Guarantee that the candidateIds set occurs in every field
        return intersection(candidateIds, attributes);
      }

      function validateUrl () {
        return self.searcher.search()
        .then(function () {
          var candidateIds;

          // Merge fields from multiple docs because some docs might not return
          // the entire list of fields possible.
          // This is not perfect as the top 10 results might not include
          // a comprehensive list, but it's the best we can do.
          angular.forEach(self.searcher.docs, function(doc) {
            var attributes = Object.keys(sourceDoc(doc));
            candidateIds = updateCandidateIds(candidateIds, attributes);

            self.fields = self.fields.concat(attributes.filter(function (attribute) {
              return self.fields.indexOf(attribute) < 0;
            }));
          });
          self.idFields = candidateIds;
          if (self.searchEngine === 'es') {
            self.fields.unshift('_id');
            self.idFields.unshift('_id');
          }
        });
      }
    };

    // Return factory object
    return Validator;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('SolrDocFactory', [
      'DocFactory',
      'solrUrlSvc',
      SolrDocFactory
    ]);

  function SolrDocFactory(DocFactory, solrUrlSvc) {
    var Doc = function(doc, options) {
      DocFactory.call(this, doc, options);
    };

    Doc.prototype = Object.create(DocFactory.prototype);
    Doc.prototype.constructor = Doc; // Reset the constructor


    Doc.prototype._url       = _url;
    Doc.prototype.explain    = explain;
    Doc.prototype.snippet    = snippet;
    Doc.prototype.source     = source;
    Doc.prototype.highlight  = highlight;

    var entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      '\'': '&#39;',
      '/': '&#x2F;'
    };

    var escapeHtml = function(string) {
      return String(string).replace(/[&<>"'\/]/g, function (s) {
        return entityMap[s];
      });
    };

    // a URL to access a the specified docId
    var buildTokensUrl = function(fieldList, url, idField, docId) {
      var escId = encodeURIComponent(solrUrlSvc.escapeUserQuery(docId));

      var tokensArgs = {
        'indent': ['true'],
        'wt': ['xml'],
        //'q': [idField + ':' + escId],
        'facet': ['true'],
        'facet.field': [],
        'facet.mincount': ['1'],
      };
      if (fieldList !== '*') {

        angular.forEach(fieldList, function(fieldName) {
          if (fieldName !== 'score') {
            tokensArgs['facet.field'].push(fieldName);
          }
        });
      }
      return solrUrlSvc.buildUrl(url, tokensArgs) + '&q=' + idField + ':'  + escId;
    };

    function _url (idField, docId) {
      /*jslint validthis:true*/
      var self = this;
      return buildTokensUrl(self.options().fieldList, self.options().url, idField, docId);
    }

    function explain (docId) {
      /*jslint validthis:true*/
      var self = this;

      if (self.options().explDict.hasOwnProperty(docId)) {
        return self.options().explDict[docId];
      } else {
        return null;
      }
    }

    function snippet (docId, fieldName) {
      /*jslint validthis:true*/
      var self = this;

      if (self.options().hlDict.hasOwnProperty(docId)) {
        var docHls = self.options().hlDict[docId];
        if (docHls.hasOwnProperty(fieldName)) {
          return docHls[fieldName];
        }
      }
      return null;
    }

    function source () {
      /*jslint validthis:true*/
      var self = this;
      return angular.copy(self.doc);
    }

    function highlight (docId, fieldName, preText, postText) {
      /*jslint validthis:true*/
      var self        = this;
      var fieldValue  = self.snippet(docId, fieldName);

      if (fieldValue && fieldValue instanceof Array) {
        if ( fieldValue.length === 0 ) {
          return null;
        }

        var escapedValues = [];

        angular.forEach(fieldValue, function(value) {
          var esc       = escapeHtml(value);
          var preRegex  = new RegExp(self.options().highlightingPre, 'g');
          var hlPre     = esc.replace(preRegex, preText);
          var postRegex = new RegExp(self.options().highlightingPost, 'g');
          var hlPost    = hlPre.replace(postRegex, postText);

          escapedValues.push(hlPost);
        });

        return escapedValues;
      } else if (fieldValue) {
        var esc       = escapeHtml(fieldValue);
        var preRegex  = new RegExp(self.options().highlightingPre, 'g');
        var hlPre     = esc.replace(preRegex, preText);
        var postRegex = new RegExp(self.options().highlightingPost, 'g');
        var hlPost    = hlPre.replace(postRegex, postText);

        return hlPost;
      } else {
        return null;
      }
    }

    return Doc;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('SolrSearcherFactory', [
      '$http',
      '$q',
      '$sce',
      '$log',
      'SolrDocFactory',
      'SearcherFactory',
      'activeQueries',
      'defaultSolrConfig',
      'solrSearcherPreprocessorSvc',
      SolrSearcherFactory
    ]);

  function SolrSearcherFactory(
    $http, $q, $sce, $log,
    SolrDocFactory, SearcherFactory,
    activeQueries, defaultSolrConfig,
    solrSearcherPreprocessorSvc
  ) {
    var Searcher = function(options) {
      SearcherFactory.call(this, options, solrSearcherPreprocessorSvc);
    };

    Searcher.prototype = Object.create(SearcherFactory.prototype);
    Searcher.prototype.constructor = Searcher; // Reset the constructor

    Searcher.prototype.addDocToGroup    = addDocToGroup;
    Searcher.prototype.pager            = pager;
    Searcher.prototype.search           = search;
    Searcher.prototype.explainOther     = explainOther;

    function addDocToGroup (groupedBy, group, solrDoc) {
      /*jslint validthis:true*/
      var self = this;

      if (!self.grouped.hasOwnProperty(groupedBy)) {
        self.grouped[groupedBy] = [];
      }

      var found = null;
      angular.forEach(self.grouped[groupedBy], function(groupedDocs) {
        if (groupedDocs.value === group && !found) {
          found = groupedDocs;
        }
      });

      if (!found) {
        found = {docs:[], value:group};
        self.grouped[groupedBy].push(found);
      }

      found.docs.push(solrDoc);
    }

    // return a new searcher that will give you
    // the next page upon search(). To get the subsequent
    // page, call pager on that searcher ad infinidum
    function pager () {
      /*jslint validthis:true*/
      var self      = this;
      var start     = 0;
      var rows      = self.config.numberOfRows;
      var nextArgs  = angular.copy(self.args);

      if (nextArgs.hasOwnProperty('rows')) {
        rows = parseInt(nextArgs.rows);
      }

      if (nextArgs.hasOwnProperty('start')) {
        start = parseInt(nextArgs.start) + rows;

        if (start >= self.numFound) {
          return null; // no more results
        }
      } else {
        start = rows;
      }

      nextArgs.rows       = ['' + rows];
      nextArgs.start      = ['' + start];
      var pageConfig      = defaultSolrConfig;
      pageConfig.sanitize = false;

      var options = {
        fieldList:          self.fieldList,
        url:                self.url,
        args:               nextArgs,
        queryText:          self.queryText,
        config:             pageConfig,
        type:               self.type,
        HIGHLIGHTING_PRE:   self.HIGHLIGHTING_PRE,
        HIGHLIGHTING_POST:  self.HIGHLIGHTING_POST,
      };

      var nextSearcher = new Searcher(options);

      return nextSearcher;
    }

    // search (execute the query) and produce results
    // to the returned future
    function search () {
      /*jslint validthis:true*/
      var self      = this;
      var url       = self.callUrl;
      self.inError  = false;

      var thisSearcher = self;

      var getExplData = function(solrResp) {
        if (solrResp.hasOwnProperty('debug')) {
          var dbg = solrResp.debug;
          if (dbg.hasOwnProperty('explain')) {
            return dbg.explain;
          }
        }
        return {};
      };

      var getOthersExplained = function(solrResp) {
        if (solrResp.hasOwnProperty('debug')) {
          var dbg = solrResp.debug;
          if (dbg.hasOwnProperty('explainOther')) {
            return dbg.explainOther;
          }
        }
      };

      var getHlData = function(solrResp) {
        if (solrResp.hasOwnProperty('highlighting')) {
          return solrResp.highlighting;
        }
        return {};
      };

      activeQueries.count++;
      return $q(function(resolve, reject) {
        var trustedUrl = $sce.trustAsResourceUrl(url);

        $http.jsonp(trustedUrl, { jsonpCallbackParam: 'json.wrf' })
          .then(function success(resp) {
            var solrResp = resp.data;
            activeQueries.count--;

            var explDict  = getExplData(solrResp);
            var hlDict    = getHlData(solrResp);
            thisSearcher.othersExplained = getOthersExplained(solrResp);

            var parseSolrDoc = function(solrDoc, groupedBy, group) {
              var options = {
                groupedBy:          groupedBy,
                group:              group,
                fieldList:          self.fieldList,
                url:                self.url,
                explDict:           explDict,
                hlDict:             hlDict,
                highlightingPre:    self.HIGHLIGHTING_PRE,
                highlightingPost:   self.HIGHLIGHTING_POST,
              };

              return new SolrDocFactory(solrDoc, options);
            };

            if (solrResp.hasOwnProperty('response')) {
              angular.forEach(solrResp.response.docs, function(solrDoc) {
                var doc = parseSolrDoc(solrDoc);
                thisSearcher.numFound = solrResp.response.numFound;
                thisSearcher.docs.push(doc);
              });
            } else if (solrResp.hasOwnProperty('grouped')) {
              angular.forEach(solrResp.grouped, function(groupedBy, groupedByName) {

                thisSearcher.numFound = groupedBy.matches;
                // add docs for a top level group
                //console.log(groupedBy.doclist.docs);
                if (groupedBy.hasOwnProperty('doclist')) {
                  angular.forEach(groupedBy.doclist.docs, function (solrDoc) {
                    var doc = parseSolrDoc(solrDoc, groupedByName, solrDoc[groupedByName]);
                    thisSearcher.docs.push(doc);
                    thisSearcher.addDocToGroup(groupedByName, solrDoc[groupedByName], doc);
                  });
                }

                // add docs for Field Collapsing results
                angular.forEach(groupedBy.groups, function(groupResp) {
                  var groupValue = groupResp.groupValue;
                  angular.forEach(groupResp.doclist.docs, function(solrDoc) {
                    var doc = parseSolrDoc(solrDoc, groupedByName, groupValue);
                    thisSearcher.docs.push(doc);
                    thisSearcher.addDocToGroup(groupedByName, groupValue, doc);
                  });
                });
              });
            }
            resolve();
          }, function error(msg) {
            activeQueries.count--;
            thisSearcher.inError = true;
            msg.searchError = 'Error with Solr query or server. Contact Solr directly to inspect the error';
            reject(msg);
          }).catch(function(response) {
            $log.debug('Failed to run search');
            return response;
          });
      });
    } // end of search()

    function explainOther (otherQuery, fieldSpec) {
      /*jslint validthis:true*/
      var self = this;

      // var args = angular.copy(self.args);
      self.args.explainOther = [otherQuery];
      solrSearcherPreprocessorSvc.prepare(self);

      // TODO: revisit why we perform the first search, doesn't seem to have
      // any use!
      return self.search()
        .then(function() {
          var start = 0;
          var rows  = self.config.numberOfRows;

          if ( angular.isDefined(self.args.rows) && self.args.rows !== null ) {
            rows = self.args.rows;
          }

          if ( angular.isDefined(self.args.start) && self.args.start !== null ) {
            start = self.args.start;
          }
          var solrParams = {
            qf:     [fieldSpec.title + ' ' + fieldSpec.id],
            rows:   [rows],
            start:  [start],
            q:      [otherQuery]
          };

          var otherSearcherOptions = {
            fieldList:          self.fieldList,
            url:                self.url,
            args:               solrParams,
            queryText:          otherQuery,
            config:             {
              numberOfRows: self.config.numberOfRows
            },
            type:               self.type,
            HIGHLIGHTING_PRE:   self.HIGHLIGHTING_PRE,
            HIGHLIGHTING_POST:  self.HIGHLIGHTING_POST,
          };

          var otherSearcher = new Searcher(otherSearcherOptions);

          return otherSearcher.search()
            .then(function() {
              self.numFound        = otherSearcher.numFound;
              self.docs            = otherSearcher.docs;
            });
        }).catch(function(response) {
          $log.debug('Failed to run explainOther');
          return response;
        });
    }

    // Return factory object
    return Searcher;
  }
})();

'use strict';

/*jslint latedef:false*/

(function() {
  angular.module('o19s.splainer-search')
    .factory('TransportFactory', [TransportFactory]);

  function TransportFactory() {
    var Transporter = function(opts) {
      var self = this;

      self.options = options;

      function options() {
        return opts;
      }
    };

    // Return factory object
    return Transporter;
  }
})();

'use strict';

angular.module('o19s.splainer-search')
  .value('activeQueries', {
    count: 0
  });

'use strict';

angular.module('o19s.splainer-search')
  .value('defaultESConfig', {
    sanitize:     true,
    highlight:    true,
    debug:        true,
    escapeQuery:  true,
    numberOfRows: 10,
    apiMethod:    'post',
    version:      '5.0'
  });

'use strict';

angular.module('o19s.splainer-search')
  .value('defaultSolrConfig', {
    sanitize:     true,
    highlight:    false,
    debug:        true,
    numberOfRows: 10,
    escapeQuery:  true
  });
