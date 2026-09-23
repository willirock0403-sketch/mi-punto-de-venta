/* Un negocio de ejemplo con dueño, una empleada y una invitación sin
   reclamar. Cada prueba parte de una copia limpia. */
const CUENTAS = {
  dueno:   { id:'u-dueno', email:'williams@test.com' },
  rosa:    { id:'u-rosa',  email:'rosita@test.com' },
  extrano: { id:'u-otro',  email:'ajeno@test.com' },
};

function escenario(){
  return {
    cuentas: Object.values(CUENTAS),
    datos: {
      negocios: [
        { id:'n1', dueno:'u-dueno', nombre:'Snack La Pasadita', activo:true, color:'oceano', logo_url:null },
        { id:'n2', dueno:'u-otro',  nombre:'Negocio Ajeno',      activo:true, color:'azul',   logo_url:null },
      ],
      empleados: [
        { id:'e1', negocio_id:'n1', nombre:'Rosa itzel', email:'rosita@test.com', rol:'empleado', usuario_id:'u-rosa', activo:true },
        { id:'e2', negocio_id:'n1', nombre:'Por llegar', email:'nuevo@test.com',  rol:'empleado', usuario_id:null,     activo:true },
      ],
      productos: [
        { id:'p1', negocio_id:'n1', nombre:'Elote Revolcado', precio:45, activo:true, orden:0, stock:null, categoria:'Antojitos' },
        { id:'p2', negocio_id:'n1', nombre:'Refresco',        precio:25, activo:true, orden:1, stock:3,    categoria:'Bebidas' },
        { id:'p9', negocio_id:'n2', nombre:'Producto Ajeno',  precio:99, activo:true, orden:0, stock:null, categoria:null },
      ],
      ventas: [
        { id:'v1', negocio_id:'n1', folio:'001', creado_en:new Date().toISOString(),
          articulos:[{nombre:'Elote Revolcado',cant:1,precio:45}], total:45, recibido:50, cambio:5,
          metodo_pago:'efectivo', empleado_nombre:'Rosa itzel', empleado_uid:'u-rosa', anulada:false },
      ],
      cortes_caja: [],
    },
  };
}

module.exports = { escenario, CUENTAS };
