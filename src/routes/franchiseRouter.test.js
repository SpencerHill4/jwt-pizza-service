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

async function createDinerUser() {
  let user = { password: "dinersecret", roles: [{ role: Role.Diner }] };
  user.name = randomName();
  user.email = user.name + "@diner.com";

  user = await DB.addUser(user);
  return { ...user, password: "dinersecret" };
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

test("throws StatusCodeError for non-admin franchise creation", async () => {
  const dinerUser = await createDinerUser();
  const loginRes = await request(app).put("/api/auth").send({
    email: dinerUser.email,
    password: dinerUser.password,
  });

  expect(loginRes.status).toBe(200);

  const createRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${loginRes.body.token}`)
    .send({
      name: `Forbidden ${randomName()}`,
      admins: [{ email: dinerUser.email }],
    });

  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe("unable to create a franchise");
});

test("admin can create a store within a franchise", async () => {
  const franchiseName = `Franchise with Store ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const storeName = `Store ${randomName()}`;
  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ name: storeName });

  expect(storeRes.status).toBe(200);
  expect(storeRes.body).toEqual(
    expect.objectContaining({
      name: storeName,
      franchiseId: franchiseRes.body.id,
    }),
  );
});

test("admin can delete a store within a franchise", async () => {
  const franchiseName = `Franchise to Remove Store ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ name: `Store to Remove ${randomName()}` });

  expect(storeRes.status).toBe(200);

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}/store/${storeRes.body.id}`)
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: "store deleted" });
});

test("admin can get a franchise", async () => {
  const franchiseName = `Franchise to Get ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const getRes = await request(app)
    .get("/api/franchise")
    .query({ page: 0, limit: 10, name: franchiseName })
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(getRes.status).toBe(200);
  expect(getRes.body.franchises).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: franchiseRes.body.id,
        name: franchiseName,
      }),
    ]),
  );
});

test("user can get all their franchises", async () => {
  const dinerUser = await createDinerUser();
  const dinerLogin = await request(app).put("/api/auth").send({
    email: dinerUser.email,
    password: dinerUser.password,
  });

  expect(dinerLogin.status).toBe(200);

  const franchiseName = `User Franchise ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: dinerUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const userFranchesRes = await request(app)
    .get(`/api/franchise/${dinerUser.id}`)
    .set("Authorization", `Bearer ${dinerLogin.body.token}`);

  expect(userFranchesRes.status).toBe(200);
  expect(userFranchesRes.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: franchiseRes.body.id,
        name: franchiseName,
      }),
    ]),
  );
});

test("admin can get another user's franchises when req.user.isRole(Role.Admin)", async () => {
  const dinerUser = await createDinerUser();
  const franchiseName = `Admin View User Franchise ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: dinerUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const adminFranchisesRes = await request(app)
    .get(`/api/franchise/${dinerUser.id}`)
    .set("Authorization", `Bearer ${adminAuthToken}`);

  expect(adminFranchisesRes.status).toBe(200);
  expect(adminFranchisesRes.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: franchiseRes.body.id,
        name: franchiseName,
      }),
    ]),
  );
});

test("throws StatusCodeError for unauthorized store creation", async () => {
  const dinerUser = await createDinerUser();
  const dinerLogin = await request(app).put("/api/auth").send({
    email: dinerUser.email,
    password: dinerUser.password,
  });

  expect(dinerLogin.status).toBe(200);

  const franchiseName = `Unauthorized Store Franchise ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set("Authorization", `Bearer ${dinerLogin.body.token}`)
    .send({ name: `Blocked Store ${randomName()}` });

  expect(storeRes.status).toBe(403);
  expect(storeRes.body.message).toBe("unable to create a store");
});

test("throws StatusCodeError for unauthorized store deletion", async () => {
  const dinerUser = await createDinerUser();
  const dinerLogin = await request(app).put("/api/auth").send({
    email: dinerUser.email,
    password: dinerUser.password,
  });

  expect(dinerLogin.status).toBe(200);

  const franchiseName = `Unauthorized Store Deletion Franchise ${randomName()}`;
  const franchiseRes = await request(app)
    .post("/api/franchise")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(franchiseRes.status).toBe(200);

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({ name: `Delete Blocked Store ${randomName()}` });

  expect(storeRes.status).toBe(200);

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}/store/${storeRes.body.id}`)
    .set("Authorization", `Bearer ${dinerLogin.body.token}`);

  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body.message).toBe("unable to delete a store");
});
