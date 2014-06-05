ActiveREST
==========

     The web library that makes fun of web libraries in its own name

ActiveREST is the stuff in between the server API and React.

It addresses these needs:
----------------------

**1. Fetching data from server**

   - Injecting it into React components
   - And saving changes back to DB

**2. Caching data**

   - So you can access it repeatedly in javascript data structures
     without re-fetching each time

**3. Allowing loading indicators when data is being fetched (spinners, etc)**

Everything else is left simple, and un-designed.  There's no
object-oriented model system.  No pubsub.  That's not necessary.

How to Use it
-----------------

Here's a basic scenario. Let's render the page for Proposal #34.

	var proposal = fetch('/proposal/34')
	React.renderComponent(<Proposal data={proposal} />, document.body)

Look at that fetch.  It goes to the server, which returns nested JSON like this:

	{ url: '/proposal/34',
	  title: 'Should I have a baby?',
	  description: '...',
	  points: [{url: '/point/34',
	            is_pro: true,
	            ...},
	            {...}
	            ]
	}

This data is cached automatically, with a line like this:

	cache[object.url] = object

  The programmer specifies a `url` field on every JSON dictionary he
  wants cached.  He can even cache nested dictionaries like
  `/point/34` above.  This RESTful `url` is a hash key.  It also has a
  second use when we save objects, which you'll learn soon.

  The cache is saved in `localStorage` so that it never dies.

The Proposal component's `render()` method can then access this data  like so:

	this.props.title
	this.props.points[3]

If the user edits the proposal title, we save the edits with:

	proposal.title = <new title>
	save(proposal)

  This will save the new data on the server.  It updates the cache,
  then does a `POST/PUT/UPDATE` request to the proposal object's `url`,
  and tells React to re-render the page.

To create a new object, just make one like this:

	var pointy_point = { url: new_url('point'),
	                     title: 'Barf on you, man!',
	                     ... }

  ...and then save it with `save()`.  This will put it in the cache and
  save it in the server.

Loading indicators
-----------
Perhaps we want to customize the HTML of a component when it's
loading.

In ActiveREST, you add a `render_loading()` method to any component
that will need a spinner.  This will automatically get called, instead
of `render()`, if the data it depends upon is still being fetched over
the internet.  When the data loads, it'll re-render with `render()`.

We can one-up the venerable `spinner.gif` with this.  We could display
proposals as outlines when loading, and fill in the text, images, and
details once they load.  Those details could be presented as "Missing
3d Cutouts" while loading.  You know, something like this:


     /\/\/\/\/\/\/\/\/\/\/\
     \                    /
     /                    \
     \                    /
     /                    \
     \/\/\/\/\/\/\/\/\/\/\/


Or this, where the # is a shadow effect:

      ____________________
     |####################|
     |#                   |
     |#                   |
     |#                   |
     |#                   |
     |#___________________|


Or a checkerboard image:


     ##  ##  ##  ##  ##  ##
       ##  ##  ##  ##  ##
     ##  ##  ##  ##  ##  ##
       ##  ##  ##  ##  ##
     ##  ##  ##  ##  ##  ##

Any component's `render_loading()` method can explicitly call their
nested child's `render_loading()` method if they wish.  To do the 3d
Cutout on a child's component, add the following line to its class:

     render_loading: render_3d_cutout,

Or if you want a spinner, use:

    render_loading: function () { return '<img src="/static/spinner.gif">' }

> NOTE: This `render_loading` API isn't currently supported.  Instead,
> put an `if` statement into your `render()` method that branches on
> `is_loading(this.props)`, like this:

    render: function () {
        if (is_loading(this.props)) {
            ... render loading indicator ...
        } else {
            ... render regular component ...
        }
    }

> I'll make the `render_loading()` method work once I implement a
> React.createClass wrapper.

Optimizations
------------
The first release will be simple but inefficient.  For instance:

  - Every changed datum will re-render the entire page.
  - The user must refresh to get changes another user made
    - A naïve polling solution needs to repeatedly re-fetch the
      entire cache to discover what changed

However, the design allows us to solve these problems later with
black-box optimizations, that we can implement without requiring
programmers to change their code.  Here are four that we could do:

  **OPTIMIZATION 1.** When new data arrives, re-render only the components
  that depend on it.  (Instead of re-rendering the whole page.)

  **OPTIMIZATION 2.** Server keeps track of what data the browser has seen
  -- a mirror of the browser's cache -- and only sends the changed
  parts to the browser for any given request.

  **OPTIMIZATION 3.** Realtime live updates, using #2.

  **OPTIMIZATION 4.** Speculatively pre-fetch data from server before it's
  needed, keeping statistics and a simple utility measure.

I have notes on how to implement these.  Lemme know if you want em.

Optimizing the cache
--------------

> NOTE: This has changed too.  We now support partially-loaded objects,
> by adding a `?loading` query parameter to the object's URL.  I'll
> update the docs later.

When we load the homepage, we only fetch summaries of each proposal.
We fetch the full details of a proposal when a user clicks into it.
Ideally, we would re-use the homepage's proposal summaries when
loading proposals, so that the user can see the proposal's title while
the details load.

Here's a way to do this in ActiveREST without any new features.  The
homepage loads a summary of each proposal, and each proposal page
loads a full proposal:

  Fetched for the homepage:

    { url: '/top_proposals'
      proposal_summaries: [{ url: '/proposal_summary/4',  title: 'Should we barf?', ... },
                           { url: '/proposal_summary/25', title: 'Should we eat?', ... },
                           ...]
    }

  Fetched for a proposal page:

    { url: '/proposal/34',
      title: 'Should we barf?',
      description: '...',
      points: [{url: '/point/34',
                is_pro: true,
                ...},
                {...}
               ]
    }

Now, in the Proposal object's `render_loading()` method, it'll check if
the summary info is in the cache, and use it if so:

    if (p = cache['/proposal_summary/34']) {
       this.props.title = p.title
       this.props.pro_points = [p.top_pro, null, null, null, null]
       this.props.con_points = [p.top_con, null, null, null, null]
    }

Specifying custom "url" keys
----------

If the programmer can't change the server's API to include a "url"
field, he can give ActiveREST a pair of custom functions:

    function cache_key_func (object) { ... return key ... }
    function save_object_url (object) { ... return url ... }

These simply default to:

    cache_key_func = save_object_url = function (object) { return object.url }

This unification of CACHING KEYS and SAVING API METHOD within RESTful
URLs is the REST part of ActiveREST.

Custom server APIs
------------

The server is free to generate its JSON responses in any way it likes,
e.g.:

 - Joins over a relational database
 - Directly mapping it to a NoSQL json data store

Giving new objects good URLs
-------------

When the client makes a new object and sends it to the server, it
generates a temp url.  For instance:

    new_url("point")  =>  "/new/point/34"

The server might name its urls according to its internal database row
ids.  That's fine.  It can choose a better url for each new object the
client sends it, return that info to the client, and the client will
keep track of the old and new url, translating between both so that
the changed url is transparent to the programmer.
  
The Name
------------
 - ACTIVE: because it's an active DB layer like ActiveRecord
 - REST:   because the data schema is defined in terms of RESTful urls

We call it ActiveREST because programmers fervently combine "Active"
records with "REST" in a programming religion that is full of
contradiction.  To embody this contradiction, ActiveREST is an
oxymoron.

The branding and religion of a product should not be contradictory.
Our branding, on the other hand, has deep meaning.  The meaning of
seeking meaning in branding, by illustrating a contradiction.

I think it would be awesome if programmers used ActiveREST for a while
without realizing that they are using an oxymoron, and then when they
find out, the jokes on them ignorant suckers!

    He's the one, who likes all our pretty songs
    And he likes to sing along
    And he likes to shoot his gun
    But he don't know what it means

    In Bloom, by Nirvana
    https://www.youtube.com/watch?v=6vqfuAczm7g

Maybe the code-name for ActiveREST can be "In Bloom", because that's
the name of the song that describes the people who don't know that the
code-name of ActiveREST is the meaning of the song "In Bloom".  They
deserve not to know it, them ignorant suckers!

Finally, the React portion of ActiveREST is named ReActiveREST.
