const {test} = require('node:test');
const assert = require('node:assert/strict');
const {amounts} = require('../src/services/kpayAmounts');

test('rounds small FCFA commissions to the nearest integer, half up', () => {
  assert.deepEqual(amounts(50,1,'15.00'),{gross:50,count:1,commission:8,net:42,rate:15});
  assert.deepEqual(amounts(50,1,'7.00'),{gross:50,count:1,commission:4,net:46,rate:7});
  assert.deepEqual(amounts(50,1,'6.99'),{gross:50,count:1,commission:3,net:47,rate:6.99});
  assert.deepEqual(amounts(51,2,'12.50'),{gross:102,count:2,commission:13,net:89,rate:12.5});
});
