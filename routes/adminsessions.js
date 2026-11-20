"use strict";

const Sessions = {

    init() {
        this.loadSessions();
        this.bindEvents();
    },

    bindEvents() {

        document.addEventListener("click", (e) => {

            if (e.target.closest(".btn-end-session")) {
                this.endSession(
                    e.target.closest(".btn-end-session").dataset.id
                );
            }

        });

    },

    loadSessions() {
        console.log("Loading active sessions...");
    },

    endSession(id) {
        console.log("Ending session:", id);
    }

};

document.addEventListener("DOMContentLoaded", () => {
    Sessions.init();
});