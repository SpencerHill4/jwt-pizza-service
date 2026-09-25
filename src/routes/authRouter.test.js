const request = require("supertest");
const app = require("../service");

const testUser = {
  name: "pizza diner",
  email: `${Math.random().toString(36).substring(2, 12)}@test.com`,
  password: "a",
};
let testUserAuthToken;

beforeAll(async () => {
  const registerRes = await request(app).post("/api/auth").send(testUser);
  expect(registerRes.status).toBe(200);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test("login", async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: "diner" }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test("rejects registration when required fields are missing", async () => {
  const registerRes = await request(app)
    .post("/api/auth")
    .send({ email: "missing-name@test.com", password: "password" });

  expect(registerRes.status).toBe(400);
  expect(registerRes.body).toEqual({
    message: "name, email, and password are required",
  });
});

test("rejects login with unknown credentials", async () => {
  const loginRes = await request(app)
    .put("/api/auth")
    .send({ email: testUser.email, password: "wrong password" });

  expect(loginRes.status).toBe(404);
  expect(loginRes.body).toEqual(
    expect.objectContaining({ message: "unknown user" }),
  );
});

test("registered user can get a crusty pizza from the menu", async () => {
  const loginRes = await request(app)
    .put("/api/auth")
    .send({ email: "a@jwt.com", password: "admin" });
  expect(loginRes.status).toBe(200);
  const adminAuthToken = loginRes.body.token;
  expectValidJwt(adminAuthToken);

  const addMenuRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      title: "Crusty",
      description: "A dry mouthed favorite",
      image: "pizza4.png",
      price: 0.0028,
    });
  expect(addMenuRes.status).toBe(200);

  const menuRes = await request(app)
    .get("/api/order/menu")
    .set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: "Crusty" })]),
  );
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/,
  );
}
