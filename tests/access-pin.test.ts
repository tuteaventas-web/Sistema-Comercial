import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAccessPin} from '../src/access-pin.ts';
test('PIN de cuatro dígitos conserva los ceros iniciales',()=>{
 const pin='0011';validateAccessPin(pin);assert.equal(pin,'0011');validateAccessPin('1122');
});
test('PIN rechaza números sin formato, longitud incorrecta y caracteres ajenos',()=>{
 for(const pin of [11,1234,null,undefined,'','123','12345',' 1234','abcd','12.3','1234\n'])assert.throws(()=>validateAccessPin(pin),/4 dígitos/);
});
