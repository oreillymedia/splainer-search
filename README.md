[![Build Status](https://travis-ci.org/o19s/splainer-search.svg?branch=master)](https://travis-ci.org/o19s/splainer-search)
[![npm version](https://badge.fury.io/js/splainer-search.svg)](https://badge.fury.io/js/splainer-search)

# AngularJS Search Service

Splainer Search is an Angular Solr and Elasticsearch Search library focussed on relevance diagnostics. It's used in relevancy tuning tools [Quepid](http://quepid.com) and [Splainer](http://splainer.io). Its available for anyone to use (see [license](LICENSE.txt)).


Splainer search utilizes a JSONP wrapper for communication with Solr. Elasticsearch communicates clearly with simple HTTP and JSON. All fields are explained and highlighted. A friendly interface is provided to specify the arguments in terms of a Javascript object. See below for basic examples.

## Basic usage

### Solr

Splainer-search will perform the specified search against Solr attempting to highlight and extract explain info.

```js
// searcher that searches id, title, body, author
var searcher = searchSvc.createSearcher(
  ['id', 'title', 'body', 'author'],
  'http://localhost:8983/solr/select',
  {
    'q': ['*:*'],
    'fq': ['title:Moby*', 'author:Herman']
  }
);

searcher.search()
.then(function() {
  angular.forEach(searcher.docs, function(doc) {
    console.log(doc.source().title);
    // highlights. You need to pass id as that's how Solr
    // organizes the explain. See below for a friendlier/higher-level
    // interface with normalDocs
    console.log(doc.highlight(doc.source().id, 'title', '<b>', '</b>');
    // explain info
    console.log(doc.explain(doc.source().id);
  });
});
```

### Elasticsearch

Splainer-search also supports ES, using the same API, and passing the query DSL in the same way ES expects it:

```js
var searcher = searchSvc.createSearcher(
  ['id:_id', 'title', 'body', 'author'],
  'http://localhost:9200/books/_search',
  {
    'query': {
      'match': {
        'title': '#$query##'
      }
    }
  }
);
```

## Paging

Paging is done by asking the original searcher for another searcher. This searcher is already setup to get the next page for the current search results. Tell that searcher to `search()` just like you did above.

```js
var results = [];
searcher.search()
.then(function() {
  angular.forEach(searcher.docs, function(doc) {
    results.push(doc.source().title));
  });
  // once results returned, get a new searcher for the next
  // page of results, just rerun the search later exactly as
  // its run here
  searcher = searcher.pager();
});

// sometime later we page...
searcher.search()
.then(function() {

});
```

## Explain Other

Let's say you have performed a search for `tacos` and you get a bunch of results, but the chef comes back to you and says:

> Hey! My new creation "La Bomba" is not showing up, fix it!!!!

So you are puzzled as to why it is not showing up, since it's clearly marked as a `taco` in the db. Wouldn't it be nice if `splainer-search` gave you some help?

Don't worry, we've got your back :)

### Solr

So assuming you already have something like this:

```js
var options = {
  fields:       ['id', 'title', 'price'],
  url:          'http://localhost:8983/solr/select',
  args:         { 'q': ['#$query##'] },
  query:        'tacos',
  config:       {},
  searchEngine: 'solr'
};
var searcher = searchSvc.createSearcher(options.fields, options.url, options.args, options.query, options.config, options.searchEngine);

searcher.search();
```

You would want to create a new searcher with the same options/context, and use the `explainOther()` function:

```js
var fieldSpec       = fieldSpecSvc.createFieldSpec(options.fields);
var explainSearcher = searchSvc.createSearcher(options.fields, options.url, options.args, options.query, options.config, options.searchEngine); # same options as above

 # assuming that we know "El Bomba" has id 63148
explainSearcher.explainOther('id:63148', fieldSpec);
```

The `explainOther()` function returns the same promise as the `search()` function so you can you retrieve the results in the same way.

### Elasticsearch

In ES, the `explainOther()` function behaves the same way, except that it does not need a `fieldSpec` param to be passed in.

```js
var options = {
  fields:       ['id', 'title', 'price'],
  url:          'http://localhost:9200/tacos/_search',
  args:         {
    'query': {
      'match': {
        'title': '#$query##'
      }
    }
  },
  query:        'tacos',
  config:       {},
  searchEngine: 'es'
};
var searcher = searchSvc.createSearcher(options.fields, options.url, options.args, options.query, options.config, options.searchEngine);

searcher.search();

var explainSearcher = searchSvc.createSearcher(options.fields, options.url, options.args, options.query, options.config, options.searchEngine); # same options as above

 # assuming that we know "El Bomba" has id 63148
explainSearcher.explainOther('id:63148');
```

The `explainOther()` function returns the same promise as the `search()` function so you can you retrieve the results in the same way.

## Normalizing docs with normalDocs/fieldSpec

This library was originally written for dealing with debug tools such as [Quepid](http://quepid.com) and [Splainer](http://splainer.io). As such, it provides a lot of help taking a user specified list of fields and associated roles, then once search is done turning the raw docs out of the Solr searcher into something more normalized based on that config (a normalDoc).

The normalDoc provides a friendlier, more standard interface. This includes friendlier parsing of explain information as needed.

```js
var userFieldSpec = "id:uuid, title, body, authors"
var fs = fieldSpecSvc.createFieldSpec(userFieldSpec)
var searcher = searchSvc.createSearcher(
  fs.fieldList(),
  'http://localhost:8983/solr/select',
  {
    'q': ['*:*'],
    'fq': ['title:Moby*', 'authors:Herman']
  }
);

searcher.search()
.then(function() {
  var  bestScore = 0;
  angular.forEach(searcher.docs, function(doc) {
    var normalDoc = normalDocSvc.createNormalDoc(fs, doc);
    // access unique id and title
    // (above specified to be uuid and title)
    console.log("ID is:" + normalDoc.id);
    console.log("Title is:" + normalDoc.id);

    // snippets -- best try to highlight the field
    angular.forEach(normalDoc.subSnippets, function(snippet, fieldName) {
      console.log('hopefully this is a highlight! ' + snippet);
    });

    // prettier and heavily sanitized explain info:
    // (the explain modal on Splainer shows this)
    console.log(normalDoc.explain());

    // hot matches contains the most important matches
    // this drives the horizontal graph bars in Quepid/Splainer
    var matches = normalDoc.hotMatches();

    // Give hotMatchesOutOf a maximum score (for all docs returned) and you'll
    // get the hot matches as a percentage of thewhole
    if (normalDoc.score() > bestScore) {
      bestScore = normalDoc.score();
    }
    var normalDoc.matchesOutOf(bestScore);

    // a link to the document in Solr is handy:
    console.log(normalDoc._url())
  })
});
```

## Specifying search engine version number

Most of what splainer-search does should be compatible with all versions of Solr and Elasticsearch. There are times though where one of these projects introducing a breaking change and it becomes necessary to specify the version number used.

For example, ES deprecated the `fields` parameter in favor of `stored_fields` (https://www.elastic.co/guide/en/elasticsearch/reference/current/breaking_50_search_changes.html#_literal_fields_literal_parameter). So it's necessary to tell splainer-search which version you are using in order to send the appropriate request.

To do so you only need to specify the version number in the `config` param when constructing a new searcher:

### ElasticSearch

```js
var options = {
  fields:       ['id', 'title', 'price'],
  url:          'http://localhost:9200/tacos/_search',
  args:         {
    'query': {
      'match': {
        'title': '#$query##'
      }
    }
  },
  query:        'tacos',
  config:       { version: 5.1 },
  searchEngine: 'es'
};
var searcher = searchSvc.createSearcher(options.fields, options.url, options.args, options.query, options.config, options.searchEngine);

searcher.search();
```

And splainer-search will take care of using the correct name in the parameters.

**NB:** The default behavior will be that of 5.x, so if you are on that version you do not need to do anything, whereas if you are on a previous version number you should provide the version number.


## Development Notes

Splainer-search is written using AngularJS project. It requires npm and grunt

Be sure you've installed npm and grunt on your machine.

* On a Mac [follow these instructions](http://thechangelog.com/install-node-js-with-homebrew-on-os-x/)
* On Ubuntu [follow these instructions](https://rtcamp.com/tutorials/nodejs/node-js-npm-install-ubuntu/)
* Use npm to install Grunt globally on your system (may require sudo)

```
npm install -g grunt-cli
```

To run the tests:

```
npm install
npm test
```

To do a release, use `np` via `npm install np` and then run it.


## Thanks to...

Development for this library is done primarily by [OpenSource Connections](http://opensourceconnections.com) for search relevance tools [Splainer](http://splainer.io) and [Quepid](http://quepid.com)

Primary author is [Doug Turnbull](http://softwaredoug.com)
