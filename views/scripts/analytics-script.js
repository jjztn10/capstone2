
window.UserAnalytics = (() => {

    "use strict";

    const API = "/userdashboard/api/analytics";
    const GREEN = "#2d5a3d";

    const $ = (id) => document.getElementById(id);

    let charts = {
        study: null,
        tasks: null,
        mood: null,
        workload: null
    };

    /* ==========================================
       HELPERS
    ========================================== */

    function notify(icon, title, text = "") {

        if (!window.Swal) {

            alert(title);

            return;

        }

        Swal.fire({

            icon,

            title,

            text,

            confirmButtonColor: GREEN,

            timer: icon === "success" ? 1500 : undefined,

            timerProgressBar: icon === "success"

        });

    }

    async function request(path = "", options = {}) {

        const response = await fetch(API + path, {

            headers: {

                "Content-Type": "application/json"

            },

            ...options

        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {

            throw new Error(

                data.error ||

                "Request failed."

            );

        }

        return data;

    }

    function destroyChart(chart) {

        if (chart) {

            chart.destroy();

        }

    }

    function updateSummary(summary) {

        $("productivityScore").textContent =
            (summary.productivity || 0) + "%";

        $("analyticsStudyHours").textContent =
            (summary.studyHours || 0) + " hrs";

        $("analyticsCompletedTasks").textContent =
            summary.completedTasks || 0;

        $("analyticsStress").textContent =
            (summary.averageStress || 0) + " / 10";

    }

    /* ==========================================
       LOAD
    ========================================== */

    async function load() {

        try {

            const data = await request();

            updateSummary(data.summary || {});

            renderStudyChart(data.study || []);

            renderTaskChart(data.tasks || {});

            renderMoodChart(data.moods || []);

            renderWorkloadChart(data.workload || []);

        }

        catch (err) {

            console.error(err);

            notify(

                "error",

                "Unable to load analytics",

                err.message

            );

        }

    }
        /* ==========================================
       STUDY HOURS CHART
    ========================================== */

    function renderStudyChart(data) {

        destroyChart(charts.study);

        const ctx = $("studyHoursChart");

        if (!ctx) return;

        charts.study = new Chart(ctx, {

            type: "line",

            data: {

                labels: data.map(x => x.label),

                datasets: [{

                    label: "Study Hours",

                    data: data.map(x => x.hours),

                    borderColor: "#2d5a3d",

                    backgroundColor: "rgba(45,90,61,.15)",

                    borderWidth: 3,

                    fill: true,

                    tension: .35

                }]

            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                plugins: {

                    legend: {

                        display: true

                    }

                },

                scales: {

                    y: {

                        beginAtZero: true

                    }

                }

            }

        });

    }

    /* ==========================================
       TASK COMPLETION CHART
    ========================================== */

    function renderTaskChart(data) {

        destroyChart(charts.tasks);

        const ctx = $("taskChart");

        if (!ctx) return;

        charts.tasks = new Chart(ctx, {

            type: "doughnut",

            data: {

                labels: [

                    "Completed",

                    "Pending",

                    "In Progress"

                ],

                datasets: [{

                    data: [

                        data.completed || 0,

                        data.pending || 0,

                        data.inProgress || 0

                    ],

                    backgroundColor: [

                        "#2d5a3d",

                        "#f6c23e",

                        "#4e73df"

                    ],

                    borderWidth: 1

                }]

            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                plugins: {

                    legend: {

                        position: "bottom"

                    }

                }

            }

        });

    }

    /* ==========================================
       MOOD TREND CHART
    ========================================== */

    function renderMoodChart(data) {

        destroyChart(charts.mood);

        const ctx = $("moodChart");

        if (!ctx) return;

        charts.mood = new Chart(ctx, {

            type: "bar",

            data: {

                labels: data.map(x => x.label),

                datasets: [{

                    label: "Mood",

                    data: data.map(x => x.score),

                    backgroundColor: "#36b9cc"

                }]

            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                scales: {

                    y: {

                        beginAtZero: true,

                        max: 4

                    }

                }

            }

        });

    }

    /* ==========================================
       WORKLOAD TREND CHART
    ========================================== */

    function renderWorkloadChart(data) {

        destroyChart(charts.workload);

        const ctx = $("workloadChart");

        if (!ctx) return;

        charts.workload = new Chart(ctx, {

            type: "line",

            data: {

                labels: data.map(x => x.label),

                datasets: [{

                    label: "Workload",

                    data: data.map(x => x.value),

                    borderColor: "#e74a3b",

                    backgroundColor: "rgba(231,74,59,.15)",

                    fill: true,

                    tension: .35,

                    borderWidth: 3

                }]

            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                scales: {

                    y: {

                        beginAtZero: true,

                        max: 10

                    }

                }

            }

        });

    }
        /* ==========================================
       REFRESH BUTTON
    ========================================== */

    $("btnRefreshAnalytics")?.addEventListener(

        "click",

        async () => {

            try {

                if (window.Swal) {

                    Swal.fire({

                        title: "Refreshing...",

                        allowOutsideClick: false,

                        showConfirmButton: false,

                        didOpen: () => Swal.showLoading()

                    });

                }

                await load();

                Swal.close();

                notify(

                    "success",

                    "Analytics updated."

                );

            }

            catch (err) {

                Swal.close();

                console.error(err);

                notify(

                    "error",

                    "Unable to refresh analytics",

                    err.message

                );

            }

        }

    );

    /* ==========================================
       AUTO LOAD
    ========================================== */

    document.addEventListener(

        "DOMContentLoaded",

        () => {

            load();

        }

    );

    /* ==========================================
       PUBLIC METHODS
    ========================================== */

    return {

        load,

        refresh: load

    };

})();
