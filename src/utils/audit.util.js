const logAudit = async (
  dbClientOrPool,
  userId,
  action,
  entityType = null,
  entityId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  userAgent = null
) => {
  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    const values = [
      userId,
      action,
      entityType,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent,
    ];

    const executor = dbClientOrPool?.query ? dbClientOrPool : null;
    if (!executor) {
      return;
    }

    await executor.query(query, values);
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

module.exports = {
  logAudit,
};
