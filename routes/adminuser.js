"use strict";

const Users = {

    init() {
        this.bindEvents();
        this.loadUsers();
    },

    bindEvents() {

        document.addEventListener("click", (e) => {

            // Add User
            if (e.target.closest("#btnAddUser")) {
                this.addUser();
            }

            // Edit User
            if (e.target.closest(".btn-edit-user")) {
                this.editUser(
                    e.target.closest(".btn-edit-user").dataset.id
                );
            }

            // Delete User
            if (e.target.closest(".btn-delete-user")) {
                this.deleteUser(
                    e.target.closest(".btn-delete-user").dataset.id
                );
            }

            // Toggle Password
            if (e.target.closest("#togglePassword")) {

                const input = document.getElementById("password");
                const icon = e.target.closest("#togglePassword").querySelector("i");

                if (input) {

                    if (input.type === "password") {
                        input.type = "text";
                        icon.classList.remove("fa-eye");
                        icon.classList.add("fa-eye-slash");
                    } else {
                        input.type = "password";
                        icon.classList.remove("fa-eye-slash");
                        icon.classList.add("fa-eye");
                    }

                }

            }

            // Toggle Confirm Password
            if (e.target.closest("#toggleConfirmPassword")) {

                const input = document.getElementById("confirmPassword");
                const icon = e.target.closest("#toggleConfirmPassword").querySelector("i");

                if (input) {

                    if (input.type === "password") {
                        input.type = "text";
                        icon.classList.remove("fa-eye");
                        icon.classList.add("fa-eye-slash");
                    } else {
                        input.type = "password";
                        icon.classList.remove("fa-eye-slash");
                        icon.classList.add("fa-eye");
                    }

                }

            }

        });

        // Student ID Format (00-0000)
        document.addEventListener("input", (e) => {

            if (e.target.id !== "username") return;

            let value = e.target.value.replace(/\D/g, "");

            value = value.substring(0, 6);

            if (value.length > 2) {
                value = value.substring(0, 2) + "-" + value.substring(2);
            }

            e.target.value = value;

        });

        // Numbers Only
        document.addEventListener("keydown", (e) => {

            if (e.target.id !== "username") return;

            const allowedKeys = [
                "Backspace",
                "Delete",
                "Tab",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End"
            ];

            if (allowedKeys.includes(e.key)) return;

            if (!/^[0-9]$/.test(e.key)) {
                e.preventDefault();
            }

        });

    },

    loadUsers() {
        console.log("Loading users...");
    },

    addUser() {
        console.log("Add user");
    },

    editUser(id) {
        console.log("Edit user:", id);
    },

    deleteUser(id) {
        console.log("Delete user:", id);
    }

};

document.addEventListener("DOMContentLoaded", () => {
    Users.init();
});