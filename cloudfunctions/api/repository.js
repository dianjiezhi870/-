'use strict';
// This adapter runs only in the privileged cloud function. Client DB access is denied.
function createRepository(db) {
  const missing = error => error && (error.errCode === -502005 || /document.*(?:not exist|not found)|DATABASE_DOCUMENT_NOT_EXIST/i.test(error.errMsg || error.message || ''));
  const clean = data => {
    const result = { ...data };
    delete result._id;
    return result;
  };
  const methods = driver => ({
    async get(collection, id) {
      try {
        const result = await driver.collection(collection).doc(id).get();
        return result.data || null;
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async set(collection, id, data) {
      await driver.collection(collection).doc(id).set({ data: clean(data) });
    }
  });
  return {
    ...methods(db),
    async query(collection, filters, options = {}) {
      let condition = filters;
      if (options.search) {
        const escaped = options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = db.RegExp({ regexp: escaped, options: 'i' });
        condition = db.command.and([filters, db.command.or([{ title: regex }, { content: regex }, { location: regex }])]);
      }
      let query = db.collection(collection).where(condition);
      for (const item of options.sort || []) query = query.orderBy(item.field, item.direction);
      if (options.offset) query = query.skip(options.offset);
      const result = await query.limit(options.limit || 20).get();
      return result.data;
    },
    async transaction(fn) {
      return db.runTransaction(async transaction => fn(methods(transaction)));
    }
  };
}
module.exports = { createRepository };
