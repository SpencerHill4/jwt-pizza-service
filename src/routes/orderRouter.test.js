const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");
const config = require("../config.js");

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

  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

let dinerUser;
let dinerAuthToken;
let adminUser;
let adminAuthToken;
let franchise;
let store;
let pepperoniMenuItem;

beforeAll(async () => {
  dinerUser = await createUser();
  dinerAuthToken = await login(dinerUser);
  adminUser = await createUser(Role.Admin);
  adminAuthToken = await login(adminUser);

  franchise = await DB.createFranchise({
    name: uniqueName("Order Test Franchise"),
    admins: [{ email: adminUser.email }],
  });
  store = await DB.createStore(franchise.id, {
    name: uniqueName("Order Test Store"),
  });
  pepperoniMenuItem = await DB.addMenuItem({
    title: uniqueName("Pepperoni"),
    description: "Pepperoni, sauce, and cheese",
    image: "pepperoni.png",
    price: 0.0065,
  });
});

beforeEach(() => {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      reportUrl: "https://factory.test/report/1",
      jwt: "factory-jwt",
    }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("gets the pizza menu", async () => {
  const menuRes = await request(app).get("/api/order/menu");

  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: pepperoniMenuItem.id,
        title: pepperoniMenuItem.title,
      }),
    ]),
  );
});

test("admin can add a menu item", async () => {
  const menuItem = {
    title: uniqueName("Vegetarian"),
    description: "Vegetables and cheese",
    image: "vegetarian.png",
    price: 0.0045,
  };

  const menuRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${adminAuthToken}`)
    .send(menuItem);

  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toEqual(
    expect.arrayContaining([expect.objectContaining(menuItem)]),
  );
});

test("rejects menu changes from a diner", async () => {
  const menuRes = await request(app)
    .put("/api/order/menu")
    .set("Authorization", `Bearer ${dinerAuthToken}`)
    .send({
      title: uniqueName("Unauthorized"),
      description: "Should not be added",
      image: "unauthorized.png",
      price: 0.001,
    });

  expect(menuRes.status).toBe(403);
  expect(menuRes.body).toEqual(
    expect.objectContaining({ message: "unable to add menu item" }),
  );
});

test("rejects unauthenticated menu changes", async () => {
  const menuRes = await request(app).put("/api/order/menu").send({
    title: "Unauthorized",
    description: "Should not be added",
    image: "unauthorized.png",
    price: 0.001,
  });

  expect(menuRes.status).toBe(401);
  expect(menuRes.body).toEqual({ message: "unauthorized" });
});

test("gets the authenticated user's orders", async () => {
  const ordersRes = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${dinerAuthToken}`);

  expect(ordersRes.status).toBe(200);
  expect(ordersRes.body).toEqual(
    expect.objectContaining({
      dinerId: dinerUser.id,
      orders: expect.any(Array),
      page: 1,
    }),
  );
});

test("rejects unauthenticated order access", async () => {
  const ordersRes = await request(app).get("/api/order");

  expect(ordersRes.status).toBe(401);
  expect(ordersRes.body).toEqual({ message: "unauthorized" });
});

test("places a pepperoni pizza order", async () => {
  const orderRequest = {
    franchiseId: franchise.id,
    storeId: store.id,
    items: [
      {
        menuId: pepperoniMenuItem.id,
        description: "Pepperoni pizza",
        price: pepperoniMenuItem.price,
      },
    ],
  };

  const orderRes = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${dinerAuthToken}`)
    .send(orderRequest);

  expect(orderRes.status).toBe(200);
  expect(orderRes.body).toEqual({
    order: expect.objectContaining(orderRequest),
    followLinkToEndChaos: "https://factory.test/report/1",
    jwt: "factory-jwt",
  });
  expect(orderRes.body.order.id).toEqual(expect.any(Number));
  expect(global.fetch).toHaveBeenCalledWith(
    `${config.factory.url}/api/order`,
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"Pepperoni pizza"'),
    }),
  );

  const ordersRes = await request(app)
    .get("/api/order")
    .set("Authorization", `Bearer ${dinerAuthToken}`);
  expect(ordersRes.body.orders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: orderRes.body.order.id,
        items: expect.arrayContaining([
          expect.objectContaining({ description: "Pepperoni pizza" }),
        ]),
      }),
    ]),
  );
});

test("reports a factory failure after creating an order", async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({ reportUrl: "https://factory.test/failed" }),
  });

  const orderRes = await request(app)
    .post("/api/order")
    .set("Authorization", `Bearer ${dinerAuthToken}`)
    .send({
      franchiseId: franchise.id,
      storeId: store.id,
      items: [
        {
          menuId: pepperoniMenuItem.id,
          description: "Pepperoni failure case",
          price: pepperoniMenuItem.price,
        },
      ],
    });

  expect(orderRes.status).toBe(500);
  expect(orderRes.body).toEqual({
    message: "Failed to fulfill order at factory",
    followLinkToEndChaos: "https://factory.test/failed",
  });
});
