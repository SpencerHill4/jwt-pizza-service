const request = require("supertest");
const app = require("../src/service");
const { DB, Role, createUser, login, uniqueName } = require("./testHelpers");

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
    name: uniqueName("Updated"),
    email: `${uniqueName("updated")}@test.com`,
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
    name: uniqueName("Admin Updated"),
    email: `${uniqueName("admin-updated")}@test.com`,
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
      email: `${uniqueName("blocked")}@test.com`,
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

test("allows an admin to delete another user", async () => {
  const user = await createUser();

  const deleteRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ deleted: true });
});

test("rejects a diner deleting another user", async () => {
  const otherUser = await createUser();

  const deleteRes = await request(app)
    .delete(`/api/user/${otherUser.id}`)
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body).toEqual({ message: "unauthorized" });
});

test("user deletion unauthorized", async () => {
  const deleteRes = await request(app).delete(`/api/user/${dinerUser.id}`);

  expect(deleteRes.status).toBe(401);
  expect(deleteRes.body).toEqual({ message: "unauthorized" });
});

test("list users unauthorized", async () => {
  const listUsersRes = await request(app).get("/api/user");
  expect(listUsersRes.status).toBe(401);
});

test("rejects a diner listing users", async () => {
  const listUsersRes = await request(app)
    .get("/api/user")
    .query({ page: 0, limit: 10, name: "*" })
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(listUsersRes.status).toBe(403);
  expect(listUsersRes.body).toEqual({ message: "unauthorized" });
});

test("list users", async () => {
  const user = await createUser();
  const listUsersRes = await request(app)
    .get("/api/user")
    .query({ page: 0, limit: 10, name: user.name })
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({
    more: false,
    users: [
      expect.objectContaining({
        id: user.id,
        name: user.name,
        email: user.email,
        roles: expect.any(Array),
      }),
    ],
  });
});

test("lists users using zero-based pages", async () => {
  const namePrefix = uniqueName("Pagination");
  const users = [];
  for (const suffix of ["first", "second"]) {
    users.push(
      await DB.addUser({
        name: `${namePrefix} ${suffix}`,
        email: `${uniqueName("pagination")}@test.com`,
        password: "password123",
        roles: [{ role: Role.Diner }],
      }),
    );
  }

  const firstPageRes = await request(app)
    .get("/api/user")
    .query({ page: 0, limit: 1, name: `${namePrefix}*` })
    .set("Authorization", `Bearer ${adminAuthToken}`);
  const secondPageRes = await request(app)
    .get("/api/user")
    .query({ page: 1, limit: 1, name: `${namePrefix}*` })
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(firstPageRes.status).toBe(200);
  expect(firstPageRes.body.users.map((user) => user.id)).toEqual([users[0].id]);
  expect(firstPageRes.body.more).toBe(true);
  expect(secondPageRes.status).toBe(200);
  expect(secondPageRes.body.users.map((user) => user.id)).toEqual([users[1].id]);
  expect(secondPageRes.body.more).toBe(false);
});