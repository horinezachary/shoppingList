const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const user_service = require("../storage/UsersService");
const secretKey = process.env.JWTSECRET || "123456789"

exports.genToken = async function (uname) {
  let user = await user_service.find_by_id(uname);
  const payload = { uname: user.uname, fname: user.fname, lname: user.lname, email: user.email}; //Add more perms here
  return jwt.sign(payload, secretKey, { expiresIn: "24h" });
};

/**
 * @param {string} token
 * @returns {object} the JWT payload
 * @throws {jwt.TokenExpiredError} when the token is expired
 * @throws {jwt.JsonWebTokenError} when the token is malformed or otherwise invalid
 * @throws {jwt.NotBeforeError} when the token issued date is before the current date
 */
exports.checkToken = async function (token) {
  const payload = jwt.verify(token, secretKey);
  return payload;
};

/**
 * @param {string} password
 * @returns {Promise<string>} the hashed password
 */
exports.hashPassword = async password => {
  return bcrypt.hash(password, 8);
};

/**
 * @param {string} password
 * @param {string} passwordHash
 * @returns {boolean} true if the password and hash match
 */
exports.checkPassword = async (password, passwordHash) => {
  return bcrypt.compare(password, passwordHash);
};

/**
 * @param {json} Authorization
 */
exports.checkJwt = async function(req,res,next) {
  const authHeader = req.get('Authorization') || ''
  const authHeaderParts = authHeader.split(' ')
  const token = authHeaderParts[0] === 'Bearer' ? authHeaderParts[1] : null
  if(token){
    try {
      const payload = jwt.verify(token, secretKey);
      req.jwt = payload
    }
    catch (err){
      console.error(err)
      res.status(401).send({error: "Invalid token"})
    }
    next()
  }
  else{
    res.status(401).send({error: "Unauthorized"})
  }
}
