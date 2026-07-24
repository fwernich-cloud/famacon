# Cesión de derechos y acuerdo de confidencialidad — Famacon Control

> Documento de cierre del desarrollo. Deja por escrito la **titularidad del código** a favor
> de Famacon y la **confidencialidad** sobre su información. Es un modelo claro y simple;
> conviene que lo revise el estudio contable/legal de Famacon antes de firmar.

**Entre:**
- **Famacon S.A.** ("Famacon"), representada por **Federico Wernich**, con domicilio en
  Buenos Aires — Argentina. CUIT: __________________.
- **Ustym Kushnir** ("el Desarrollador"), con domicilio en __________________.
  Documento/ID: __________________.

**Objeto:** el software **Famacon Control** — servidor, motor de cálculo, avisos por WhatsApp,
tablero interno, administración de datos de producto y el sitio web — desarrollado por el
Desarrollador para Famacon (el "Software").

---

## 1. Cesión de derechos (titularidad)
1.1. El Desarrollador **cede y transfiere a Famacon, en forma exclusiva, perpetua e
irrevocable, la totalidad de los derechos patrimoniales** sobre el Software y su documentación,
incluyendo el código fuente, la base de datos, los scripts, la configuración y los diseños,
en los términos de la Ley 11.723 de Propiedad Intelectual y normas complementarias.

1.2. La titularidad de la **cuenta del servidor** (VPS, dominio `famaconcontrol.com`) y del
**repositorio de código** es de Famacon desde el inicio. El Desarrollador participó como
**colaborador con acceso revocable**, sin derechos de dueño.

1.3. Famacon puede usar, modificar, continuar, contratar a terceros para mantener o rehacer, y
explotar el Software sin ninguna limitación ni pago adicional al Desarrollador.

1.4. **Componentes de terceros / código abierto.** El Software se apoya en componentes de
código abierto (por ej. Node.js, PostgreSQL/TimescaleDB, Fastify, entre otros), cada uno bajo
su propia licencia. La cesión de esta sección alcanza al **código propio de Famacon Control**,
no a esos componentes, que se siguen usando bajo sus respectivas licencias (todas permisivas y
sin costo).

---

## 2. Entrega (handoff)
Al cierre, el Desarrollador entrega y deja operativo:
- El **código completo** en el repositorio de Famacon.
- Los **accesos y credenciales** (servidor, base de datos, dominio/TLS, WhatsApp), para que
  Famacon los administre y **rote** a su nombre.
- La **documentación de operación**: `docs/RUNBOOK.md`, `docs/ARCHITECTURE.md`,
  `docs/WHATSAPP.md`.
- **Respaldos automáticos diarios con restauración probada** (`scripts/backup.sh`,
  `scripts/restore-test.sh`).

Realizada la entrega y rotadas las credenciales, **el acceso del Desarrollador se revoca**.

---

## 3. Confidencialidad
3.1. El Desarrollador mantendrá en **estricta confidencialidad** y no usará ni divulgará, fuera
de lo necesario para el desarrollo, la información de Famacon a la que accedió, en particular:
- Los **datos de producto** (diámetros de cilindro, tabla de bombeo, geometría de tanques,
  constantes de cálculo y η) — **ventaja competitiva** de Famacon.
- Los **datos de los productores y sus campos** (nombres, teléfonos, ubicaciones, lecturas).
- Las **credenciales, claves y configuración** del sistema.

3.2. La obligación de confidencialidad **subsiste después** de terminada la relación.

3.3. No se consideran confidenciales la información de dominio público o la que el Desarrollador
ya poseía legítimamente antes del proyecto.

---

## 4. Datos personales (Ley 25.326)
4.1. Los productores son personas identificables (por su teléfono). El Software captura
**consentimiento auditable** para el envío de avisos por WhatsApp y cubre baja y rectificación.

4.2. El Desarrollador **no conserva ni utiliza** datos personales de productores fuera del
sistema, y los elimina de cualquier entorno de prueba al cierre. El **responsable del
tratamiento** de esos datos es **Famacon**.

---

## 5. Garantía y soporte (opcional — completar según se acuerde)
5.1. El Desarrollador corrige, sin cargo, los **defectos** del Software reportados dentro de
los ____ días posteriores a la aprobación de cada entregable, siempre que no deriven de cambios
hechos por terceros.

5.2. El **mantenimiento posterior** y las **nuevas funciones** (por ej. la fase 2 / mejoras) se
acuerdan aparte, en la modalidad por hora prevista en la propuesta.

---

## 6. Varios
6.1. Este documento se rige por las **leyes de la República Argentina**.
6.2. Cualquier modificación se hace por escrito y firmada por ambas partes.

---

**Lugar y fecha:** ____________________________________

<br>

**Por Famacon S.A.**  \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
Federico Wernich · Aclaración/DNI: ______________

<br>

**El Desarrollador**  \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
Ustym Kushnir · Aclaración/ID: ______________
