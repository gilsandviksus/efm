/*
 * EFM - Epub for Monocle
 * 
 * A pure-javascript implementation of the book data object for Monocle.
 * 
 * Copyright (c) 2013 Robert Schroll
 * 
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

MIMETYPES = {
    png: "image/png",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    js: "text/javascript",
    css: "text/css",
    svg: "image/svg+xml",
}

// Get the directory portion of path.  Include a trailing slash unless
// there is no directory.  The path separator is '/', for use with zip
// files.
function getDir(path) {
    var dir = path.split('/').slice(0,-1).join('/');
    if (dir.length > 0)
        dir += '/';
    return dir;
}

// A book data object for the Epub file 'epubfile', a HTML5 File object.
// The callback will be called when this object is fully initialized,
// with this object as an argument.
function Epub(epubfile, callback) {
    var files = {};      // Maps filename to zip.Entry
    var spine = [];      // List of filenames in spine
    var contents = [];   // Table of contents
    var metadata = {};   // Maps keys to metadata
    var data_urls = {};  // Maps filename to data URL of file contents
    var num_data_urls = 0;
    zip.createReader(new zip.BlobReader(epubfile), function (zipReader) {
        zipReader.getEntries(function (entries) {
            for (i in entries) {
                e = entries[i];
                files[e.filename] = e;
            }
            zipReader.close();
            getComponent("META-INF/container.xml", findOPF);
            // This starts a chain of callbacks, which will eventually
            // end with onLoaded().
        });
    }, console.error);
    
    // Find the location of the OPF file from container.xml
    findOPF = function (xml) {
        var doc = new DOMParser().parseFromString(xml, "text/xml");
        var opffn = doc.getElementsByTagName("rootfile")[0].getAttribute("full-path");
        getComponent(opffn, parseOPF(getDir(opffn)));
    };
    
    // Parse the OPF file to get the spine, the table of contents, and
    // the metadata.
    parseOPF = function (reldir) {
        return function (xml) {
            var doc = new DOMParser().parseFromString(xml, "text/xml");
            var idmap = {};
            var nav_href = null;
            
            // Parse manifest
            var manifest = doc.getElementsByTagName("manifest")[0];
            var items = manifest.getElementsByTagName("item");
            for (var i=0; i<items.length; i++) {
                item = items[i];
                var id = item.getAttribute("id");
                var href = item.getAttribute("href");
                idmap[id] = reldir + href;
                var props = item.getAttribute("properties")
                if (props != null && props.split(" ").indexOf("nav") > -1)
                    nav_href = idmap[id];
            }
            
            // Parse spine
            var spineel = doc.getElementsByTagName("spine")[0];
            var sitems = spineel.getElementsByTagName("itemref");
            for (var i=0; i<sitems.length; i++) {
                id = sitems[i].getAttribute("idref");
                spine.push(idmap[id]);
            }
            
            // Parse table of contents
            if (nav_href != null) {  // Epub3 navigation
                getComponent(nav_href, parseNav(getDir(nav_href)));
            } else {  // Epub2 navigation
                var ncxfile = idmap[spineel.getAttribute("toc")];
                if (ncxfile != undefined)
                    getComponent(ncxfile, parseNCX(getDir(ncxfile)));
            }
            
            // Parse metadata
            var metadatael = doc.getElementsByTagName("metadata")[0];
            for (var i=0; i<metadatael.childNodes.length; i++) {
                var node = metadatael.childNodes[i];
                if (node.nodeType == 1 && node.firstChild != null) 
                    metadata[node.localName] = node.firstChild.nodeValue;
            }
            
            // Make data URLs for auxillary files, for future use
            for (var fn in files) {
                if (spine.indexOf(fn) == -1 && ["mimetype", "META-INF/container.xml"].indexOf(fn) == -1) {
                    num_data_urls += 1;
                    getEncodedComponent(fn, function (f) {
                        return function (data) {
                            data_urls[f] = data;
                            num_data_urls -= 1;
                            if (num_data_urls == 0)
                                onLoaded();
                        };
                    }(fn));
                }
            }
            if (num_data_urls == 0) {
                onLoaded();
            }
        };
    };
    
    // Parse the Epub3 table of contents.
    parseNav = function (reldir) {
        return function (navdata) {
            var navdoc = new DOMParser().parseFromString(navdata, "text/xml");
            var navs = navdoc.getElementsByTagName("nav");
            for (var i=0; i<navs.length; i++) {
                var nav = navs[i];
                if (nav.getAttribute("epub:type") == "toc")
                    contents = self.parseNavList(nav.getElementsByTagName("ol")[0], reldir);
            }
        };
    };
    
    parseNavList = function (element, reldir) {
        var children = [];
        for (var i=0; i<element.childNodes.length; i++) {
            var node = element.childNodes[i];
            if (node.nodeType == 1 && node.nodeName == "li") {
                var link = node.getElementsByTagName("a")[0];
                if (link != undefined) {
                    var child = { title: link.firstChild.nodeValue,
                                  src: reldir + link.getAttribute("href") };
                    var olist = node.getElementsByTagName("ol")[0];
                    if (olist != undefined)
                        child["children"] = parseNavList(olist, reldir);
                    children.push(child);
                }
            }
        }
        return children;
    };
    
    // Parse the Epub2 table of contents.
    parseNCX = function (reldir) {
        return function (ncxdata) {
            var ncx = new DOMParser().parseFromString(ncxdata, "text/xml");
            var navmap = ncx.getElementsByTagName("navMap")[0];
            contents = self.parseNCXChildren(navmap, reldir);
        };
    };
    
    parseNCXChildren = function(element, reldir) {
        var children = [];
        for (var i=0; i<element.childNodes.length; i++) {
            var node = element.childNodes[i];
            if (node.nodeType == 1 && node.nodeName == "navPoint") {
                var child = {};
                var nav_label = node.getElementsByTagName("text")[0];
                child["title"] = nav_label.firstChild.nodeValue;
                var content = node.getElementsByTagName("content")[0];
                child["src"] = reldir + content.getAttribute("src");
                var child_nav = parseNCXChildren(node, reldir);
                if (child_nav.length > 0)
                    child["children"] = child_nav;
                children.push(child);
            }
        }
        return children;
    };
    
    // Part of Monocle's book data object interface.
    getComponents = function () {
        return spine;
    };
    
    // Part of Monocle's book data object interface.
    getContents = function () {
        return contents;
    };
    
    // Part of Monocle's book data object interface.
    // Note that X?H?TML files are parsed and URLs in <img> and <link>
    // to resouces in the Epub are replaced with data URLs.
    getComponent = function (id, callback) {
        var reldir = getDir(id);
        var ext = id.split('.').slice(-1)[0];
        if (["html", "xhtml", "xml"].indexOf(ext) != -1) {
            files[id].getData(new zip.TextWriter(), function (data) {
                var doc = new DOMParser().parseFromString(data, "text/xml");
                var imgs = doc.getElementsByTagName("img");
                for (var i=0; i<imgs.length; i++) {
                    var img = imgs[i];
                    var src = reldir + img.getAttribute("src");
                    var data_url = data_urls[src];
                    if (data_url != undefined)
                        img.setAttribute("src", data_url);
                }
                
                var links = doc.getElementsByTagName("link");
                for (var i=0; i<links.length; i++) {
                    var l = links[i];
                    var href = reldir + l.getAttribute("href");
                    var data_url = data_urls[href];
                    if (data_url != undefined)
                        l.setAttribute("href", data_url);
                }
                
                callback(new XMLSerializer().serializeToString(doc));
            });
        } else {
            files[id].getData(new zip.TextWriter(), function (data) {
                callback(data);
            });
        }
    };
    
    // Return the content, via the callback, as a data URL.
    getEncodedComponent = function (id, callback) {
        var mime = MIMETYPES[id.split('.').slice(-1)[0]];
        files[id].getData(new zip.Data64URIWriter(mime), function (data) {
            callback(data);
        });
    };
    
    // Part of Monocle's book data object interface.
    getMetaData = function (key) {
        return metadata[key];
    }
    
    // Called at the end of the initialization process.  At this point,
    // the object is ready to be passed to a Monocle.Reader.
    onLoaded = function () {
        callback(this);
    };
}
