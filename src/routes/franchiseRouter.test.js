const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: "toomanysecrets", roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + "@admin.com";

  user = await DB.addUser(user);
  return { ...user, password: "toomanysecrets" };
}

let adminUser;
let adminAuthToken;

beforeAll(async () => {
  adminUser = await createAdminUser();
  const loginRes = await request(app).put("/api/auth").send({
    email: adminUser.email,
    password: adminUser.password,
  });

  expect(loginRes.status).toBe(200);
  adminAuthToken = loginRes.body.token;
});

test("admin can create a franchise", async () => {
  const franchiseName = `Test Franchise ${randomName()}`;
  const createRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(createRes.status).toBe(200);
  expect(createRes.body).toEqual(
    expect.objectContaining({
      name: franchiseName,
      admins: expect.arrayContaining([
        expect.objectContaining({
          email: adminUser.email,
          name: adminUser.name,
        }),
      ]),
    }),
  );
});

test("admin can delete a franchise", async () => {
  const franchiseName = `To Delete ${randomName()}`;
  const createRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(createRes.status).toBe(200);

  const deleteRes = await request(app).delete(
    `/api/franchise/${createRes.body.id}`,
  );

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: "franchise deleted" });
});
