export function validateAccessPin(value:unknown):asserts value is string {
 if(typeof value!=='string'||!/^[0-9]{4}$/.test(value))throw Error('El PIN debe tener exactamente 4 dígitos');
}
