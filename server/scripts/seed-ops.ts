import "varlock/auto-load";
import { pool } from "../src/db/client.ts";
import type { EventRow } from "../src/db/schema.ts";
import { logger } from "../src/lib/logger.ts";
import { createEvent, updateEvent } from "../src/services/events/events.service.ts";

// Demo data for the drone, vehicle and personnel templates in server/templates.
// Not idempotent: each run adds another set.

const BY = "seed-ops";
type Data = Record<string, unknown>;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

const create = (type: string, header: string, data: Data, eventTime?: Date) =>
  createEvent({ createdBy: BY, updatedBy: null, type, header, data, eventTime });

const ref = (event: EventRow | undefined) =>
  event && { eventId: event.eventId, label: event.header };

const patchData = (event: EventRow, data: Data) =>
  updateEvent(event.eventId, { data: { ...(event.data as Data), ...data } }, BY);

type Task = {
  header: string;
  tila: string;
  hours: number;
  data: Data;
  /** Index of the drone/vehicle the task picked, and the state that left it in; no state when it has since been released. */
  picked?: [number, string?];
};

/** Tasks as the forms leave them: the task references its pick, the pick references the task. */
const seedTasks = async (type: string, pickKey: string, entities: EventRow[], tasks: Task[]) => {
  const created: EventRow[] = [];
  for (const { header, tila, hours, data, picked } of tasks) {
    const entity = picked && entities[picked[0]];
    const task = await create(
      type,
      header,
      { ...data, tila, ...(entity && { [pickKey]: ref(entity) }) },
      hoursAgo(hours),
    );
    if (entity && picked?.[1]) await patchData(entity, { tila: picked[1], tehtava: ref(task) });
    created.push(task);
  }
  return created;
};

const seedDrones = async () => {
  const drones: EventRow[] = [];
  for (const [tunnus, laitetyyppi, tila] of [
    ["D-001", "DJI Mavic", "Ladattu"],
    ["D-002", "DJI Mavic", "Ladattu"],
    ["D-003", "Sensofusion AirX", "Ladattu"],
    ["D-004", "AttackD One", "Ladattu"],
    ["D-005", "AttackD One", "Ladattu"],
    ["D-006", "DJI Mavic", "Käytetty"],
    ["D-007", "Sensofusion AirX", "Käytetty"],
    ["D-008", "DJI Mavic", "Ladattu"],
    ["D-009", "AttackD One", "Ladattu"],
  ]) {
    drones.push(await create("form-drone", tunnus, { laitetyyppi, tila }));
  }

  const crew = (lentotyyppi: string, lentaja: string) => ({
    lentotyyppi,
    lentaja,
    navigaattori: "Kettu 5",
    reittipisteet: "LP1 → KP2 → KP3 → LP1",
    paattymisaika: "16:00",
  });
  const tasks = await seedTasks("form-flight-task", "drone", drones, [
    {
      header: "Tiedustelu tie 12 risteys",
      tila: "Jonossa",
      hours: -2,
      data: crew("Tiedustelu", "Kärpä 7"),
      picked: [0, "Tehtävällä"],
    },
    {
      header: "Sillan valvonta",
      tila: "Hyväksytty",
      hours: -1,
      data: crew("Tiedustelu", "Haukka 2"),
      picked: [1, "Tehtävällä"],
    },
    {
      header: "Metsätien tiedustelu",
      tila: "Lennossa",
      hours: 0.5,
      data: crew("Tiedustelu", "Korppi 4"),
      picked: [2, "Tehtävällä"],
    },
    {
      header: "Isku kohteeseen K-14",
      tila: "Lennossa",
      hours: 0.2,
      data: crew("Isku", "Ilves 1"),
      picked: [3, "Tehtävällä"],
    },
    {
      header: "Isku kohteeseen K-09",
      tila: "Raportoimatta",
      hours: 3,
      data: crew("Isku", "Susi 3"),
      picked: [4, "Tehtävällä"],
    },
    {
      header: "Aamutiedustelu sektori B",
      tila: "Valmis",
      hours: 8,
      data: crew("Tiedustelu", "Haukka 2"),
      picked: [1],
    },
    {
      header: "Pommitus kohteeseen K-03",
      tila: "Peruttu",
      hours: 6,
      data: crew("Pommitus", "Kärpä 7"),
      picked: [5],
    },
    {
      header: "Reitin tarkistus",
      tila: "Jonossa",
      hours: -4,
      data: crew("Tiedustelu", "Korppi 4"),
      picked: [1],
    },
  ]);

  const done = tasks[5] as EventRow;
  const report = await create(
    "form-flight-report",
    "Tehtäväraportti",
    {
      tehtava: ref(done),
      tulos: "Onnistunut",
      lentoaika: 35,
      havainnot: "Kaksi ajoneuvoa sektorin B pohjoisreunalla, ei liikettä.",
    },
    hoursAgo(7),
  );
  await patchData(done, { raportti: ref(report) });
  logger.info({ drones: drones.length, tasks: tasks.length }, "drones and flight tasks seeded");
};

const seedVehicles = async () => {
  const vehicles: EventRow[] = [];
  for (const [rekisteri, malli, ajoneuvotyyppi, tila] of [
    ["ABC-123", "Toyota Hilux", "Pakettiauto", "Vapaa"],
    ["DEF-456", "Volvo FL", "Kuorma-auto", "Vapaa"],
    ["GHI-789", "Mercedes G", "Maastoajoneuvo", "Vapaa"],
    ["JKL-012", "Skoda Octavia", "Henkilöauto", "Vapaa"],
    ["MNO-345", "Sisu E13", "Kuorma-auto", "Huollossa"],
  ]) {
    vehicles.push(await create("form-vehicle", rekisteri, { malli, ajoneuvotyyppi, tila }));
  }

  const route = (tilaaja: string, lahto: string, kohde: string, lasti: string) => ({
    tilaaja,
    lahto,
    kohde,
    lasti,
    reitti: "Reitti A1",
    paluuaika: "18:00",
    hyvaksyja: "Kotka 1",
  });
  const tasks = await seedTasks("form-drive-task", "ajoneuvo", vehicles, [
    {
      header: "Ammustäydennys 2. jk",
      tila: "Jonossa",
      hours: 1,
      data: route("2. jk", "Huoltokeskus", "2. jk tuliasema", "Ammukset 12 laatikkoa"),
      picked: [0, "Varattu"],
    },
    {
      header: "Polttoainekuljetus",
      tila: "Ajossa",
      hours: 2,
      data: route("Huoltojoukkue", "Varikko", "Komentopaikka", "Diesel 2000 l"),
      picked: [1, "Ajossa"],
    },
    {
      header: "Henkilökuljetus",
      tila: "Ajossa",
      hours: 0.5,
      data: route("Esikunta", "Komentopaikka", "Kasarmi", "4 henkilöä"),
      picked: [2, "Ajossa"],
    },
    {
      header: "Muonakuljetus",
      tila: "Valmis",
      hours: 5,
      data: route("1. jk", "Kenttäkeittiö", "1. jk", "Muona 40 hlö"),
      picked: [3],
    },
    {
      header: "Varaosien nouto",
      tila: "Jonossa",
      hours: 0.2,
      data: route("Korjaamo", "Varikko", "Korjaamo", "Varaosat"),
      picked: [0],
    },
  ]);
  logger.info(
    { vehicles: vehicles.length, tasks: tasks.length },
    "vehicles and drive tasks seeded",
  );
};

const seedPersonnel = async () => {
  const people: EventRow[] = [];
  for (const [nimi, arvo, tehtava, yksikko, tila] of [
    ["Matti Virtanen", "Alikersantti", "Lentäjä", "Dronejoukkue", "Paikalla"],
    ["Anna Laine", "Kersantti", "Lentäjä", "Dronejoukkue", "Tehtävällä"],
    ["Jussi Korhonen", "Alikersantti", "Navigaattori", "Dronejoukkue", "Paikalla"],
    ["Liisa Nieminen", "Kersantti", "Ryhmänjohtaja", "1. ryhmä", "Paikalla"],
    ["Pekka Heikkinen", "Korpraali", "Kuljettaja", "Huoltojoukkue", "Lomalla"],
    ["Sari Mäkelä", "Kersantti", "Huoltoaliupseeri", "Huoltojoukkue", "Paikalla"],
    ["Ville Salo", "Kapteeni", "Päällikkö", "Esikunta", "Paikalla"],
    ["Tiina Koskinen", "Luutnantti", "Joukkueenjohtaja", "1. joukkue", "Sairaana"],
    ["Antti Järvinen", "Sotamies", "Taistelija", "1. ryhmä", "Poissa"],
  ] as const) {
    people.push(
      await create("form-person", nimi, { arvo, tehtava, yksikko, puhelin: "040 123 4567", tila }),
    );
  }

  for (const [i, koulutus, tulos, h] of [
    [0, "Dronelentäjän peruskurssi", "Hyväksytty", 240],
    [1, "Dronelentäjän peruskurssi", "Hyväksytty", 240],
    [2, "Karttaharjoitus", "Kesken", 48],
    [3, "Ensiapu 1", "Hyväksytty", 120],
    [8, "Ensiapu 1", "Hylätty", 120],
  ] as const) {
    await create(
      "form-training",
      "Koulutus",
      { henkilo: ref(people[i]), koulutus, kouluttaja: "Kettu 5", tulos },
      hoursAgo(h),
    );
  }
  for (const [i, osaAlue, arvosana, h] of [
    [0, "Lentotaito", "4", 72],
    [1, "Lentotaito", "5", 72],
    [3, "Johtaminen", "4", 96],
    [7, "Johtaminen", "3", 96],
  ] as const) {
    await create(
      "form-evaluation",
      "Arviointi",
      { henkilo: ref(people[i]), "osa-alue": osaAlue, arvosana, arvioija: "Kotka 1" },
      hoursAgo(h),
    );
  }
  logger.info({ people: people.length }, "personnel seeded");
};

const main = async () => {
  await seedDrones();
  await seedVehicles();
  await seedPersonnel();
};

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
