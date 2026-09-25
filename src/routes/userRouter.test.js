const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

function uniqueValue(prefix) {
  return `${prefix}-${Math.random().toString(36).substring(2, 12)}`;
}

async function createUser(role = Role.Diner) {
  const password = "password123";
  const name = uniqueValue("User");
  const email = `${uniqueValue("user")}@test.com`;
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

  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

let dinerUser;
let dinerAuthToken;
let adminUser;
let adminAuthToken;

beforeAll(async () => {
  dinerUser = await createUser();
  dinerAuthToken = await login(dinerUser);
  adminUser = await createUser(Role.Admin);
  adminAuthToken = await login(adminUser);
});

test("gets the authenticated user's profile", async () => {
  const userRes = await request(app)
    .get("/api/user/me")
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(userRes.status).toBe(200);
  expect(userRes.body).toEqual(
    expect.objectContaining({
      id: dinerUser.id,
      name: dinerUser.name,
      email: dinerUser.email,
      roles: [{ role: Role.Diner }],
    }),
  );
  expect(userRes.body.password).toBeUndefined();
});

test("rejects an unauthenticated profile request", async () => {
  const userRes = await request(app).get("/api/user/me");

  expect(userRes.status).toBe(401);
  expect(userRes.body).toEqual({ message: "unauthorized" });
});

test("updates the authenticated user's profile and returns a new token", async () => {
  const user = await createUser();
  const authToken = await login(user);
  const updatedUser = {
    name: uniqueValue("Updated"),
    email: `${uniqueValue("updated")}@test.com`,
    password: "newpassword123",
  };

  const updateRes = await request(app)
    .put(`/api/user/${user.id}`)
    .set("Authorization", `Bearer ${authToken}`)
    .send(updatedUser);

  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toEqual(
    expect.objectContaining({
      id: user.id,
      name: updatedUser.name,
      email: updatedUser.email,
    }),
  );
  expect(updateRes.body.user.password).toBeUndefined();
  expect(updateRes.body.token).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );

  const reloginRes = await request(app).put("/api/auth").send({
    email: updatedUser.email,
    password: updatedUser.password,
  });
  expect(reloginRes.status).toBe(200);
});

test("allows an admin to update another user", async () => {
  const user = await createUser();
  const update = {
    name: uniqueValue("Admin Updated"),
    email: `${uniqueValue("admin-updated")}@test.com`,
    password: "adminupdated123",
  };

  const updateRes = await request(app)
    .put(`/api/user/${user.id}`)
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send(update);

  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toEqual(
    expect.objectContaining({
      id: user.id,
      name: update.name,
      email: update.email,
    }),
  );
});

test("rejects a diner updating another user", async () => {
  const otherUser = await createUser();

  const updateRes = await request(app)
    .put(`/api/user/${otherUser.id}`)
    .set("Authorization", `Bearer ${dinerAuthToken}`)
    .send({
      name: "Unauthorized update",
      email: `${uniqueValue("blocked")}@test.com`,
      password: "blockedpassword",
    });

  expect(updateRes.status).toBe(403);
  expect(updateRes.body).toEqual({ message: "unauthorized" });
});

test("rejects an unauthenticated profile update", async () => {
  const updateRes = await request(app)
    .put(`/api/user/${dinerUser.id}`)
    .send({ name: "Unauthorized update" });

  expect(updateRes.status).toBe(401);
  expect(updateRes.body).toEqual({ message: "unauthorized" });
});

test("returns the delete-user placeholder for an authenticated user", async () => {
  const deleteRes = await request(app)
    .delete(`/api/user/${dinerUser.id}`)
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: "not implemented" });
});

test("returns the user-list placeholder for an authenticated user", async () => {
  const listRes = await request(app)
    .get("/api/user")
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual({
    message: "not implemented",
    users: [],
    more: false,
  });
});

test("rejects unauthenticated user deletion and listing", async () => {
  const deleteRes = await request(app).delete(`/api/user/${dinerUser.id}`);
  const listRes = await request(app).get("/api/user");

  expect(deleteRes.status).toBe(401);
  expect(deleteRes.body).toEqual({ message: "unauthorized" });
  expect(listRes.status).toBe(401);
  expect(listRes.body).toEqual({ message: "unauthorized" });
});
