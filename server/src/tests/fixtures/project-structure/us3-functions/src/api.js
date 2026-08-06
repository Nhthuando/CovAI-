export async function api({ id }, ...rest) { return { id, rest }; }
const helper = (value = 1) => value;
const privateHelper = () => true;
module.exports.helper = helper;
