const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  const loginRes = await request(app)
    .put("/api/auth")
    .send({ email: "a@jwt.com", password: "admin" });
  let adminAuthToken = loginRes.body.token;
  expectValidJwt(adminAuthToken);
  await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send({
      title: "Crusty",
      description: "A dry mouthed favorite",
      image: "pizza4.png",
      price: 0.0028,
    });
});

test("login", async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: "diner" }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test("registered user can get a crusty pizza from the menu", async () => {
  const menuRes = await request(app)
    .get("/api/order/menu")
    .set("Authorization", `Bearer ${testUserAuthToken}`);

  console.log("MENU SEED:", menuRes.status, menuRes.body);

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
