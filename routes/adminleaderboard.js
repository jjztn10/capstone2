"use strict";

const Leaderboard = {

    init() {
        this.loadLeaderboard();
    },

    loadLeaderboard() {
        console.log("Loading leaderboard...");
    }

};

document.addEventListener("DOMContentLoaded", () => {
    Leaderboard.init();
});