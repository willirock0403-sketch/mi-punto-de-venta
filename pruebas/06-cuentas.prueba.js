/* Registro, roles e invitaciones. Aquí ya salieron dos errores: quien
   creaba un negocio entraba como empleado, y el primer login de un
   empleado firmaba sus ventas con el correo en vez de su nombre. */
module.exports = {
  titulo: 'Cuentas: registro, roles e invitaciones',
  casos: {

    async 'quien crea un negocio entra como dueño'(t){
      const p = await t.abrir({ sesion: null });
      await p.evaluate(async () => {
        verModo('registro');
        $('#re-email').value = 'donpepe@test.com';
        $('#re-pass').value = 'secreta123';
        $('#re-acepto').checked = true;
        await uiRegistro();
      });
      await p.waitForTimeout(600);
      t.afirmar.ok(await p.evaluate(()=>!!document.querySelector('#p-onboarding.activa')),
        'tras registrarse no pidió crear el negocio');
      await p.evaluate(async () => { $('#ob-nombre').value = 'Tacos Don Pepe'; await uiCrearNegocio(); });
      await p.waitForTimeout(700);
      const r = await p.evaluate(() => ({
        rol: ESTADO.rol,
        botones: [...document.querySelectorAll('#pos-root .mega')].map(b=>b.textContent.trim()),
      }));
      t.afirmar.igual(r.rol, 'admin', 'quien creó el negocio no quedó de dueño');
      t.afirmar.igual(r.botones.length, 4, `el dueño nuevo no ve todos sus botones: ${JSON.stringify(r.botones)}`);
    },

    async 'cerrar sesión no deja rastros del rol anterior'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      t.afirmar.igual(await p.evaluate(()=>ESTADO.rol), 'empleado', 'no entró como empleada');
      const r = await p.evaluate(async () => { await uiLogout(); return ESTADO.rol; });
      t.afirmar.igual(r, 'admin', 'el rol quedó contaminado tras cerrar sesión');
    },

    async 'el empleado firma con su nombre desde el PRIMER login'(t){
      // la ficha existe con correo pero la liga a la cuenta todavía no se ve
      const datos = t.escenario().datos;
      datos.empleados[0].usuario_id = null;
      const p = await t.abrir({ sesion: t.CUENTAS.rosa, datos });
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        return { miNombre: ESTADO.miNombre, firma: ESTADO.ultimaVenta.empleado_nombre };
      });
      t.afirmar.igual(r.miNombre, 'Rosa itzel', 'el primer login usó el correo en vez del nombre');
      t.afirmar.igual(r.firma, 'Rosa itzel', 'la primera venta quedó firmada con el correo');
    },

    async 'el contador sigue contando aunque le cambien el nombre'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        ESTADO.miNombre = 'Rosa I. Martínez';       // el admin se lo corrige
        await irInicio();
        return document.querySelector('.ch-total')?.textContent.trim();
      });
      // la del escenario + la de ahorita, las dos firmadas con su cuenta
      t.afirmar.igual(r, '2', 'al cambiarle el nombre se le perdieron sus ventas');
    },

    async 'el dueño ve a su equipo y el empleado solo su cuenta'(t){
      const jefe = await t.abrir();
      await jefe.evaluate(() => irConfig());
      await jefe.waitForTimeout(400);
      const sJefe = await jefe.evaluate(()=>[...document.querySelectorAll('.config-item .lbl')].map(e=>e.textContent.trim().split('\n')[0]));
      t.afirmar.ok(sJefe.some(x=>x.startsWith('Equipo')), `el dueño no ve la sección de equipo: ${JSON.stringify(sJefe)}`);

      const emp = await t.abrir({ sesion: t.CUENTAS.rosa });
      await emp.evaluate(() => irConfig());
      await emp.waitForTimeout(400);
      const sEmp = await emp.evaluate(()=>[...document.querySelectorAll('.config-item .lbl')].map(e=>e.textContent.trim().split('\n')[0]));
      t.afirmar.no(sEmp.some(x=>x.startsWith('Equipo')), 'la empleada ve la sección de equipo');
      t.afirmar.no(sEmp.some(x=>x.startsWith('Productos')), 'la empleada ve la sección de productos');
    },

    async 'quien se registra con el correo invitado entra al negocio'(t){
      // e2 es la invitación de nuevo@test.com que el dueño dejó preparada.
      // OJO: lo único que hace falta para quedarse con ese lugar es
      // REGISTRARSE con ese correo. Si en Supabase la confirmación de
      // correo está apagada, cualquiera que adivine el correo invitado
      // puede tomar el lugar sin tener acceso al buzón. Esta prueba fija
      // el comportamiento; la protección vive en la configuración de
      // Supabase (Authentication → Sign In / Providers → Confirm email).
      const p = await t.abrir({ sesion: null });
      await p.evaluate(async () => {
        verModo('registro');
        $('#re-email').value = 'nuevo@test.com';
        $('#re-pass').value = 'secreta123';
        $('#re-acepto').checked = true;
        await uiRegistro();
      });
      await p.waitForTimeout(900);
      const r = await p.evaluate(() => ({
        rol: ESTADO.rol,
        negocio: ESTADO.negocio && ESTADO.negocio.nombre,
        botones: [...document.querySelectorAll('#pos-root .mega')].map(b=>b.textContent.trim()),
      }));
      t.afirmar.igual(r.negocio, 'Snack La Pasadita', 'la invitación no ligó la cuenta al negocio');
      t.afirmar.igual(r.rol, 'empleado', 'la invitación dio permisos de más');
      t.afirmar.mismo(r.botones, ['Nueva venta','Ajustes'], 'el invitado entró con botones de dueño');
    },

    async 'una cuenta sin negocio no entra de gorra a otro'(t){
      const p = await t.abrir({ sesion: { id:'u-fantasma', email:'fantasma@test.com' } });
      const r = await p.evaluate(() => ({
        pantalla: [...document.querySelectorAll('.pantalla.activa')].map(x=>x.id).join(','),
        negocio: ESTADO.negocio,
      }));
      t.afirmar.igual(r.pantalla, 'p-onboarding', `una cuenta ajena acabó en: ${r.pantalla}`);
      t.afirmar.no(r.negocio, 'una cuenta sin invitación se quedó con un negocio');
    },

  }
};
