"use strict";

const Mood = {

    init() {
        this.loadMoodChart();
        this.loadMoodTable();
    },

    loadMoodChart() {
        console.log("Loading mood chart...");
    },

    loadMoodTable() {
        console.log("Loading mood analytics...");
    }

};

document.addEventListener("DOMContentLoaded", () => {
    Mood.init();
});