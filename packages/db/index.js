const { PrismaClient } = require("@prisma/client");

const prisma = global.__lmsPrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__lmsPrisma = prisma;

module.exports = { prisma };
