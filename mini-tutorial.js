/*
 * mini-tutorial.js (https://www.wpvs.de/mini-tutorial/)
 * © 2018  Dennis Schulmeister-Zimolong <dennis@pingu-mail.de>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 */
"use strict";

import Hammer from "hammerjs";

import StringUtils from "@dschulmeis/ls-utils/string_utils.js";

/**
 * This tiny class controls our web application. It is really meant to be
 * instantiated once the page has loaded to take over all control of the
 * page. Just like its big brother lecture-slides.js it can be extended
 * with plugins to provide additional features or HTML tags. Plugins are
 * simple objects the following method:
 *
 *   » preprocessHtml(html):
 *     Called at least once the page has been fully loaded or when the
 *     `ls-callback-html-changed` event is received any element. Receives
 *     an HTML element which is either the container element in which the
 *     sections resides or the element for which the  `ls-callback-html-changed`
 *     event was triggered.
 */
export default class MiniTutorial {
    /**
     * Yeah! The construktor. The optional configuration options may contain
     * the following attributes:
     *
     *   » tocStyle:
     *     "hamburger" to hide the toc behind a hamburger button
     *
     *   » sectionTitle:
     *     Query string for HTML element to display the section title
     *
     *   » noKeyboardNav:
     *     Don't register keyboard navigation event handlers
     *
     *   » noTouchNav:
     *     Don't register touch gesture navigation handlers
     *
     *   » download:
     *     An array of URLs with additional HTML content to download. This
     *     is intended to split up large documents. The downloaded files
     *     should not be full HTML documents, but rather directly contain
     *     additional <section> elements to append to the main document.
     *
     *   » plugins:
     *     List of lecture-slides.js compatible plugin objects which extend
     *     the application with additional features or HTML tags. Unlike
     *     lecture-slides.js these are given as an array of instances here.
     *
     * @param {Object} config Configuration options (optional)
     */
    constructor(config) {
        this._config = config || {};
        this._config.tocStyle = this._config.tocStyle || "permanent";
        this._config.tocList = this._config.tocList || "ol";
        this._config.sectionTitle = this._config.sectionTitle || "";
        this._config.noKeyboardNav = this._config.noKeyboardNav || false;
        this._config.noTouchNav = this._config.noTouchNav || false;
        this._config.download = this._config.download || [];
        this._config.plugins = this._config.plugins || [];

        this._bodyElement = document.querySelector("body");
        this._mainElement = document.querySelector("main");
        this._sectionElements = document.querySelectorAll("section");
        this._navElement = document.querySelector("nav");

        this._currentSectionIndex = 0;
        this._amountSections = 0;
        this._titlePrefix = document.title;
        this._eventHandlersRegistered = false;
    }

    /**
     * Call this method in a window load event handler, in order to start
     * the application. Like this:
     *
     *   window.addEventListener("load", async () => {
     *       let mt = new MiniTutorial({
     *           // Optional configuration values
     *       });
     *
     *       await mt.start();
     *   });
     */
    async start() {
        let index = location.hash.slice(1);
        index = parseInt(index);
        if (isNaN(index)) index = 1;

        await this._downloadHtmlContent();

        this._registerEventHandlers();
        this._gobbleWhitespace();
        this._cloneSections();
        this._countSections();
        this._hideAllSections();
        this._insertHeadings();
        this._buildTOC();
        this._showSection(index);

        location.hash = index;
    }

    /**
     * Download additional HTML content and append it to the main document.
     */
    async _downloadHtmlContent() {
        if (!this._config.download) return;
        let promises = [];

        for (let url of this._config.download) {
            promises.push(new Promise(async (resolve, reject) => {
                let response = await fetch(url);
                let html = await response.text();
                resolve(html);
            }));
        }

        (await Promise.all(promises)).forEach(html => this._mainElement.innerHTML += html);
        this._sectionElements = document.querySelectorAll("section");
    }

    /**
     * Register event handlers for routing, keyboard and touch navigation.
     */
    _registerEventHandlers() {
        if (this._eventHandlersRegistered) return;
        this._eventHandlersRegistered = true;

        window.addEventListener("hashchange", () => this._onHashChange());

        if (!this._config.noKeyboardNav) {
            window.addEventListener("keyup", event => this._onKeyUp(event));
        }

        if (!this._config.noTouchNav) {
            delete Hammer.defaults.cssProps.userSelect; // Allow text selection on Desktop
            let hammer = new Hammer.Manager(this._bodyElement);

            hammer.add(new Hammer.Swipe({event: "swipe-left", direction: Hammer.DIRECTION_LEFT}));
            hammer.on("swipe-left", event => this._onTouchGesture(event));

            hammer.add(new Hammer.Swipe({event: "swipe-right", direction: Hammer.DIRECTION_RIGHT}));
            hammer.on("swipe-right", event => this._onTouchGesture(event));
        }

        window.addEventListener("ls-callback-html-changed", event => {
            if (!event.detail) return;

            for (let plugin of this._config.plugins) {
                if (!plugin.preprocessHtml) continue;
                plugin.preprocessHtml(event.detail);
            }
        });

        window.dispatchEvent(new CustomEvent("ls-callback-html-changed", {
            detail: this._mainElement,
        }));
    }

    /**
     * Eat leading whitespace for all elements with data-gobble attribute.
     * This helps to insert code examples into the page.
     */
    _gobbleWhitespace() {
        for (let element of document.querySelectorAll("[data-gobble]")) {
            element.innerHTML = StringUtils.removeSurroundingWhitespace(element.innerHTML);
        }
    }

    /**
     * Resolve <section data-clone="#sec-xxx"></section> so that the section
     * referenced in data-clone will be duplicated.
     */
    _cloneSections() {
        document.querySelectorAll("section[data-clone]").forEach(element => {
            let source = document.querySelector(element.dataset.clone);
            if (!source) return;

            element.innerHTML = source.innerHTML;
            if (!element.dataset.title) element.dataset.title = source.dataset.title;
        });
    }

    /**
     * Assigns each <section> its index with dataset.index, starting with
     * index 1. Also sets this._amountSections with the maximum allowed index.
     */
    _countSections() {
        this._amountSections = 0;

        this._sectionElements.forEach(section => {
            if (section.id === "toc") return;
            if (section.dataset.chapter != null) return;
            section.dataset.index = ++this._amountSections;
        });
    }

    /**
     * Hide all <section> elements except the one with id="toc", which is the
     * Table of Contents. This simply adds the CSS class "hidden" to each
     * section.
     */
    _hideAllSections() {
        this._sectionElements.forEach(section => {
            if (section.id === "toc") return;
            section.classList.add("hidden");
        });
    }

    /**
     * Hide all section elements and show the one with the given index, instead.
     * The index always starts at 1, since index 0 is the Table of Contents,
     * which should always be visible.
     *
     * @param {int} index <section> to be shown, starting at 1
     */
    _showSection(index) {
        // Check index
        index = Math.max(Math.min(index, this._amountSections), 1);
        this._currentSectionIndex = index;

        // Show requested <section>
        this._hideAllSections();

        let section = document.querySelector(`section[data-index="${index}"]`);
        if (!section) return;
        section.classList.remove("hidden");

        window.dispatchEvent(new CustomEvent("ls-callback-section-changed", {
            detail: section,
        }));

        // Apply background color
        this._bodyElement.style.backgroundColor = section.dataset.backgroundColor || "";
        let backgroundImage = section.dataset.backgroundImage || "";

        if (backgroundImage) {
            this._bodyElement.style.backgroundImage = `url(${backgroundImage})`;
        } else {
            this._bodyElement.style.backgroundImage = "";
        }

        // Reset window scroll bars
        window.scrollTo(0, 0);

        // Update window title
        if (section.dataset.title) {
            document.title = `${this._titlePrefix} – ${section.dataset.title}`;
        } else {
            document.title = this._titlePrefix;
        }

        // Update central page title
        if (this._config.sectionTitle) {
            let titleElement = document.querySelector(this._config.sectionTitle);
            if (titleElement) {
                titleElement.classList.add("no-print");
                titleElement.textContent = section.dataset.title;
            }
        }

        // Highlight current <section> in the Table of Contents
        document.querySelectorAll("#toc li a").forEach(link => link.classList.remove("active"));
        let link = document.querySelector(`#toc li[data-index="${index}"] a`);
        if (link) link.classList.add("active");

        // Update navigation links
        if (this._navElement) {
            this._navElement.innerHTML = "";
            let link_prev = document.createElement("a");
            let link_next = document.createElement("a");

            this._navElement.appendChild(link_prev);
            this._navElement.appendChild(link_next);

            if (index > 1) {
                let sectionPrev = document.querySelector(`section[data-index="${index - 1}"]`);

                if (sectionPrev && sectionPrev.dataset.title) {
                    link_prev.textContent = sectionPrev.dataset.title;
                    link_prev.href = "#" + (index - 1);
                }
            }

            if (index < this._amountSections) {
                let sectionNext = document.querySelector(`section[data-index="${index + 1}"]`);

                if (sectionNext && sectionNext.dataset.title) {
                    link_next.textContent = sectionNext.dataset.title;
                    link_next.href = "#" + (index + 1);
                }
            }
        }

        // Show <body> in case it is still invisible. This prevents flickering
        // all <section> at the initial page load.
        this._bodyElement.classList.remove("hidden");
    }

    /**
     * Place an <h2> heading at the beginning of each <section>, except for
     * the Table of Contents, which gets an <h3> heading. The heading is taken
     * from the data-title attribute of each <section>.
     */
    _insertHeadings() {
        this._sectionElements.forEach(section => {
            let title = section.dataset.title;
            if (!title) return;

            let classnames = [];

            if (section.id === "toc") classnames.push("toc-title");
            else if (section.dataset.chapter !== undefined) classnames.push("chapter-title");
            else classnames.push("section-title");

            if (this._config.sectionTitle || section.dataset.chapter !== undefined) {
                classnames.push("print-only");
            }

            let heading = document.createElement("h2");
            classnames.forEach(cls => heading.classList.add(cls));
            heading.textContent = title;

            section.insertBefore(heading, section.childNodes[0]);
        });
    }

    /**
     * Build Table of Contents
     */
    _buildTOC() {
        let sectionToc = document.getElementById("toc");
        if (!sectionToc) return;

        let tocElements = [];
        let index = 0;
        let list = null;

        this._sectionElements.forEach(section => {
            let title = section.dataset.title;
            if (title === undefined) return;

            if (section.dataset.chapter != null) {
                let heading = document.createElement("h3");
                heading.textContent = section.dataset.title;
                tocElements.push(heading);

                list = null;
                return;
            } else if (!section.dataset.index) {
                return;
            }

            if (!list) {
                list = document.createElement(this._config.tocList === "ol" ? "ol" : "ul");
                tocElements.push(list);

                if (this._config.tocList === "none") {
                    list.classList.add("tocListNone");
                }
            }

            let link = document.createElement("a");
            link.textContent = title;
            link.href = "#" + section.dataset.index;
            // if (section.dataset.icon != undefined) link.classList.add(section.dataset.icon);

            let listItem = document.createElement("li");
            listItem.dataset.index = section.dataset.index;
            listItem.appendChild(link);
            list.appendChild(listItem);

            if (section.dataset.icon != undefined) {
                let icon = document.createElement("span");
                icon.classList.add("icon");
                icon.classList.add(section.dataset.icon);
                link.before(icon);
            }
        });

        if (this._config.tocStyle === "hamburger") {
            let buttonElement = document.createElement("div");
            buttonElement.classList.add("toc-hamburger-button");
            buttonElement.classList.add("__mt__icon-menu");
            buttonElement.classList.add("no-print");

            let menuElement = document.createElement("div");
            menuElement.classList.add("toc-hamburger-menu");
            menuElement.classList.add("hidden");
            tocElements.forEach(element => menuElement.appendChild(element));

            sectionToc.appendChild(buttonElement);
            sectionToc.appendChild(menuElement);

            buttonElement.addEventListener("click", () => {
                if (menuElement.classList.contains("hidden")) {
                    menuElement.classList.remove("hidden");
                } else {
                    menuElement.classList.add("hidden");
                }
            })
        } else {
            tocElements.forEach(element => sectionToc.appendChild(element));
        }
    }

    /**
     * Minimal single page router. Switch the currently visible section
     * mentioned in the URL hash.
     */
    _onHashChange() {
        let index = parseInt(location.hash.slice(1));

        if (Number.isNaN(index)) {
            index = 1;
        }

        this._showSection(index);
    }

    /**
     * Keyboard navigation. Switch visible <section> with Arrow Left, Arrow
     * Right, Space and Enter.

     * @param {DOMEvent} event Captured keyup event
     */
    _onKeyUp(event) {
        if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
        if (event.target.nodeName != "BODY" && event.target.nodeName != "SECTION"
                && event.target.nodeNode != "MAIN") return;

        switch (event.code) {
            case "ArrowLeft":
                // Go to previous section
                if (this._currentSectionIndex > 1) {
                    location.hash = this._currentSectionIndex - 1;
                }
                break;
            case "ArrowRight":
            case "Enter":
                // Go to next section
                if (this._currentSectionIndex < this._sectionElements.length - 1) {
                    location.hash = this._currentSectionIndex + 1;
                }
                break;
        }
    }

    /**
     * Handle touch gestures. The following gestures are supported:
     *
     *   * Swipe left: Next slide
     *   * Swipe right: Previous slide
     * @param  {[HammerEvent]} event hammer.js touch gesture event
     */
    _onTouchGesture(event) {
        if (event.pointerType === "mouse") return;

        switch (event.type) {
            case "swipe-left":
                // Go to previous section
                if (this._currentSectionIndex > 1) {
                    location.hash = this._currentSectionIndex - 1;
                }
                break;
            case "swipe-right":
                // Go to next section
                if (this._currentSectionIndex < this._sectionElements.length - 1) {
                    location.hash = this._currentSectionIndex + 1;
                }
                break;
        }
    }
}
