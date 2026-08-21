import { faker } from "@faker-js/faker";
import { admiraltyCredibilityEnum, admiraltyReliabilityEnum } from "../src/db/schema.ts";
import type { CreateEventInput } from "../src/services/events/events.service.ts";

const INPUT_SOURCES = ["facebook", "twitter", "telegram", "rss", "manual"];
const TAGS = ["shipping", "port", "oil", "environment", "cyber", "border"];
const DOMAINS = ["Infrastructure", "Legal", "Economy", "Information", "Military", "Diplomatic"];
const TYPES = ["observation", "report", "alert"];

const pickN = <T>(arr: readonly T[], n: number): T[] => faker.helpers.arrayElements([...arr], n);

export const generateFakeEvent = (createdBy = "fake-events"): CreateEventInput => ({
  createdBy,
  updatedBy: null,
  header: faker.lorem.sentence(),
  eventTime: faker.date.recent({ days: 7 }),
  tags: pickN(TAGS, 2),
  hcoeDomains: pickN(DOMAINS, 2),
  admiraltyReliability: faker.helpers.arrayElement(admiraltyReliabilityEnum.enumValues),
  admiraltyAccuracy: faker.helpers.arrayElement(admiraltyCredibilityEnum.enumValues),
  location: faker.location.city(),
  locationPoint: [
    faker.location.longitude({ min: 20, max: 30 }),
    faker.location.latitude({ min: 59, max: 70 }),
  ],
  inputSource: faker.helpers.arrayElement(INPUT_SOURCES),
  sourceUri: null,
  type: faker.helpers.arrayElement(TYPES),
  data: null,
});
