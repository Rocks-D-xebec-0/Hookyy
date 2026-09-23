// Hookyy reads Cucumber Messages: exact hook locations, tag expressions, and hooks that never ran.
module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['steps/**/*.js'],
    format: ['progress', 'message:reports/hookyy.ndjson'],
  },
};
