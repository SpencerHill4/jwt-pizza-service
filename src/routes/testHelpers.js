const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

function uniqueName(prefix) {
  return `${prefix} ${Math.random().toString(36).substring(2, 12)}`;
}

async function createUser(role = Role.Diner) {
  const password = "password123";
  const name = uniqueName("User");
  const email = `${uniqueName("user")}@test.com`;
  const user = await DB.addUser({
    name,
    email,
    password,
    roles: [{ role }],
  });

  return { ...user, password };
}

async function login(user) {
  const loginRes = await request(app).put("/api/auth").send({
    email: user.email,
    password: user.password,
  });

  if (loginRes.status !== 200) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }
  return loginRes.body.token;
}

module.exports = { Role, DB, createUser, login, uniqueName };
