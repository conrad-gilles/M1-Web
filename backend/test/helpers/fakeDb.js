/*
 * Remplace MongoDB par des tableaux en mémoire, pour tester les routes sans
 * base de données. Les documents restent de vrais documents Mongoose : les
 * schémas, la validation et toPublic() sont donc ceux de l'application. Seul
 * le sous-ensemble de requêtes utilisé par le backend est simulé.
 */

/** Valeurs trouvées en suivant un chemin "a.b", y compris à travers un tableau. */
function valuesAt(source, pathParts) {
  if (pathParts.length === 0) return [source];
  if (source == null) return [];
  if (Array.isArray(source)) return source.flatMap((item) => valuesAt(item, pathParts));
  return valuesAt(source[pathParts[0]], pathParts.slice(1));
}

const comparable = (value) => (value instanceof Date ? value.getTime() : String(value));

function matches(doc, filter = {}) {
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return Object.entries(filter).every(([key, condition]) => {
    const values = valuesAt(plain, key.split("."));
    if (condition && typeof condition === "object" && "$lt" in condition) {
      return values.some((value) => comparable(value) < comparable(condition.$lt));
    }
    return values.some((value) => comparable(value) === comparable(condition));
  });
}

/** Imite une requête Mongoose chaînable, exécutée quand elle est attendue. */
function query(run) {
  const options = {};
  const chain = {
    sort: (spec = { createdAt: -1 }) => ((options.sorted = spec), chain),
    skip: (n) => ((options.skip = n), chain),
    limit: (n) => ((options.limit = n), chain),
    select: () => chain,
    lean: () => ((options.lean = true), chain),
    then: (resolve, reject) => {
      try {
        resolve(run(options));
      } catch (error) {
        reject(error);
      }
    },
  };
  return chain;
}

const duplicateKey = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

export function installFakeDb(...models) {
  const stores = new Map(models.map((model) => [model, []]));
  let clock = 0;

  for (const Model of models) {
    const all = () => stores.get(Model);
    const uniquePaths = Object.keys(Model.schema.paths).filter(
      (name) => Model.schema.paths[name].options.unique,
    );

    const assertUnique = (doc) => {
      for (const name of uniquePaths) {
        if (all().some((other) => other !== doc && other[name] === doc[name])) throw duplicateKey();
      }
    };

    const applyUpdate = (doc, update) => {
      for (const [key, value] of Object.entries(update.$set || {})) doc.set(key, value);
      for (const [key, value] of Object.entries(update.$push || {})) doc[key].push(value);
      for (const [key, condition] of Object.entries(update.$pull || {})) {
        doc.set(key, doc[key].filter((item) => !matches(item, condition)));
      }
      assertUnique(doc);
    };

    Model.create = async (fields) => {
      const doc = new Model(fields);
      const invalid = doc.validateSync();
      if (invalid) throw invalid;
      assertUnique(doc);
      // Dates croissantes : l'ordre de tri par createdAt est déterministe.
      doc.createdAt = doc.updatedAt = new Date(Date.now() + (clock += 1));
      doc.save = async () => {
        const error = doc.validateSync();
        if (error) throw error;
        return doc;
      };
      all().push(doc);
      return doc;
    };

    /** Comme Mongoose : tout est validé avant d'enregistrer quoi que ce soit. */
    Model.insertMany = async (list) => {
      const docs = list.map((fields) => new Model(fields));
      for (const doc of docs) {
        const invalid = doc.validateSync();
        if (invalid) throw invalid;
      }
      const created = [];
      for (const doc of docs) created.push(await Model.create(doc.toObject()));
      return created;
    };

    Model.find = (filter) =>
      query((options) => {
        let found = all().filter((doc) => matches(doc, filter));
        if (options.sorted) {
          const [field, direction] = Object.entries(options.sorted)[0];
          const value = (doc) => (doc[field] instanceof Date ? doc[field].getTime() : doc[field]);
          found = [...found].sort((a, b) => (value(a) < value(b) ? -direction : value(a) > value(b) ? direction : 0));
        }
        if (options.skip) found = found.slice(options.skip);
        if (options.limit) found = found.slice(0, options.limit);
        return options.lean ? found.map((doc) => doc.toObject()) : found;
      });

    Model.findOne = (filter) =>
      query((options) => {
        const doc = all().find((candidate) => matches(candidate, filter)) || null;
        return doc && options.lean ? doc.toObject() : doc;
      });

    Model.countDocuments = async (filter) => all().filter((doc) => matches(doc, filter)).length;

    Model.findOneAndUpdate = (filter, update) =>
      query(() => {
        const doc = all().find((candidate) => matches(candidate, filter)) || null;
        if (doc) applyUpdate(doc, update);
        return doc;
      });

    Model.updateOne = async (filter, update) => {
      const doc = all().find((candidate) => matches(candidate, filter));
      if (doc) applyUpdate(doc, update);
      return { matchedCount: doc ? 1 : 0 };
    };

    const removeWhere = (filter, onlyFirst) => {
      const removed = [];
      stores.set(
        Model,
        all().filter((doc) => {
          const hit = matches(doc, filter) && !(onlyFirst && removed.length > 0);
          if (hit) removed.push(doc);
          return !hit;
        }),
      );
      return removed;
    };

    Model.findOneAndDelete = (filter) => query(() => removeWhere(filter, true)[0] || null);
    Model.deleteOne = async (filter) => ({ deletedCount: removeWhere(filter, true).length });
    Model.deleteMany = async (filter) => ({ deletedCount: removeWhere(filter, false).length });
  }

  return {
    /** Documents actuellement « en base » pour un modèle. */
    all: (Model) => stores.get(Model),
    reset: () => models.forEach((Model) => stores.set(Model, [])),
  };
}
