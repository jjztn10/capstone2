"use strict";

/* ==========================================================
   SMARTWORK TASK MANAGEMENT
========================================================== */

const TaskManager = {

    tasks: [],
    filteredTasks: [],
    currentPage: 1,
    rowsPerPage: 10,

    init() {
        this.cacheDom();
        this.bindEvents();
        this.loadExistingRows();
        this.updateCounter();
    },

    cacheDom() {

        this.tableBody = document.getElementById("tasksTableBody");
        this.searchInput = document.getElementById("searchTask");
        this.statusFilter = document.getElementById("statusFilter");
        this.priorityFilter = document.getElementById("priorityFilter");
        this.dateFilter = document.getElementById("dateFilter");
        this.pagination = document.getElementById("taskPagination");
        this.counter = document.getElementById("taskCounter");
        this.refreshBtn = document.getElementById("btnRefreshTasks");
        this.addBtn = document.getElementById("btnAddTask");

    },

    bindEvents() {

        if (this.searchInput) {
            this.searchInput.addEventListener("keyup", () => this.filterTable());
        }

        if (this.statusFilter) {
            this.statusFilter.addEventListener("change", () => this.filterTable());
        }

        if (this.priorityFilter) {
            this.priorityFilter.addEventListener("change", () => this.filterTable());
        }

        if (this.dateFilter) {
            this.dateFilter.addEventListener("change", () => this.filterTable());
        }

        if (this.refreshBtn) {
            this.refreshBtn.addEventListener("click", () => location.reload());
        }

        if (this.addBtn) {
            this.addBtn.addEventListener("click", () => {
                console.log("Add Task");
                // open task modal here
            });
        }

        document.addEventListener("click", (e) => {

            const viewBtn = e.target.closest(".btn-view-task");
            const editBtn = e.target.closest(".btn-edit-task");
            const deleteBtn = e.target.closest(".btn-delete-task");

            if (viewBtn) {
                this.viewTask(viewBtn.dataset.id);
            }

            if (editBtn) {
                this.editTask(editBtn.dataset.id);
            }

            if (deleteBtn) {
                this.deleteTask(deleteBtn.dataset.id);
            }

        });

    },

    loadExistingRows() {

        this.tasks = [...this.tableBody.querySelectorAll("tr")];
        this.filteredTasks = [...this.tasks];

    },

    updateCounter() {

        if (!this.counter) return;

        this.counter.textContent =
            `${this.filteredTasks.length} Tasks`;

    },    /* ==========================================
       FILTER TABLE
    ========================================== */

    filterTable() {

        const keyword = this.searchInput
            ? this.searchInput.value.toLowerCase().trim()
            : "";

        const status = this.statusFilter
            ? this.statusFilter.value.toLowerCase()
            : "";

        const priority = this.priorityFilter
            ? this.priorityFilter.value.toLowerCase()
            : "";

        const date = this.dateFilter
            ? this.dateFilter.value
            : "";

        this.filteredTasks = this.tasks.filter(row => {

            const cells = row.querySelectorAll("td");

            if (cells.length < 7) return false;

            const title =
                cells[1].innerText.toLowerCase();

            const statusText =
                cells[4].innerText.toLowerCase();

            const priorityText =
                cells[3].innerText.toLowerCase();

            const dueDate =
                cells[6].innerText.trim();

            const matchKeyword =
                !keyword || title.includes(keyword);

            const matchStatus =
                !status || statusText.includes(status);

            const matchPriority =
                !priority || priorityText.includes(priority);

            const matchDate =
                !date || dueDate === date;

            return (
                matchKeyword &&
                matchStatus &&
                matchPriority &&
                matchDate
            );

        });

        this.currentPage = 1;

        this.renderTable();

        this.updateCounter();

    },

    /* ==========================================
       RENDER TABLE
    ========================================== */

    renderTable() {

        if (!this.tableBody) return;

        this.tableBody.innerHTML = "";

        if (this.filteredTasks.length === 0) {

            this.tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-5">
                        <i class="fas fa-tasks fa-3x text-muted mb-3"></i>
                        <h5>No Tasks Found</h5>
                    </td>
                </tr>
            `;

            if (this.pagination) {
                this.pagination.innerHTML = "";
            }

            return;

        }

        const start =
            (this.currentPage - 1) * this.rowsPerPage;

        const end =
            start + this.rowsPerPage;

        const rows =
            this.filteredTasks.slice(start, end);

        rows.forEach(row => {

            this.tableBody.appendChild(row);

        });

        this.renderPagination();

    },    /* ==========================================
       PAGINATION
    ========================================== */

    renderPagination() {

        if (!this.pagination) return;

        this.pagination.innerHTML = "";

        const totalPages = Math.ceil(
            this.filteredTasks.length / this.rowsPerPage
        );

        if (totalPages <= 1) return;

        // Previous
        const prev = document.createElement("li");
        prev.className =
            `page-item ${this.currentPage === 1 ? "disabled" : ""}`;

        prev.innerHTML = `
            <a href="#" class="page-link">&laquo;</a>
        `;

        prev.addEventListener("click", (e) => {
            e.preventDefault();

            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderTable();
            }
        });

        this.pagination.appendChild(prev);

        // Page Numbers
        for (let i = 1; i <= totalPages; i++) {

            const page = document.createElement("li");

            page.className =
                `page-item ${i === this.currentPage ? "active" : ""}`;

            page.innerHTML = `
                <a href="#" class="page-link">${i}</a>
            `;

            page.addEventListener("click", (e) => {

                e.preventDefault();

                this.currentPage = i;

                this.renderTable();

            });

            this.pagination.appendChild(page);

        }

        // Next
        const next = document.createElement("li");

        next.className =
            `page-item ${this.currentPage === totalPages ? "disabled" : ""}`;

        next.innerHTML = `
            <a href="#" class="page-link">&raquo;</a>
        `;

        next.addEventListener("click", (e) => {

            e.preventDefault();

            if (this.currentPage < totalPages) {

                this.currentPage++;

                this.renderTable();

            }

        });

        this.pagination.appendChild(next);

    },

    /* ==========================================
       TASK ACTIONS
    ========================================== */

    viewTask(id) {

        console.log("View Task:", id);

        // TODO:
        // Open View Task Modal

    },

    editTask(id) {

        console.log("Edit Task:", id);

        // TODO:
        // Open Edit Task Modal

    },

    deleteTask(id) {

        console.log("Delete Task:", id);

        // TODO:
        // Delete Task Confirmation

    }

};

/* ==========================================
   INITIALIZE
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    TaskManager.init();

});