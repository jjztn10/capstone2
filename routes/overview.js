"use strict";

const Overview = {

    init() {
        this.loadStatistics();
        this.loadCharts();
        this.loadRecentActivities();
    },

    loadStatistics() {
        console.log("Loading overview statistics...");
    },

    loadCharts() {
        console.log("Loading charts...");
    },

    loadRecentActivities() {
        console.log("Loading recent activities...");
    }

};

document.addEventListener("DOMContentLoaded", () => {
    Overview.init();
});