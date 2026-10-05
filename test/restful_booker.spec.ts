import pactum from 'pactum';
import { SimpleReporter } from '../simple-reporter';
import { faker } from '@faker-js/faker';
import { StatusCodes } from 'http-status-codes';

/**
 * Suíte de testes automatizados da API Restful Booker
 * Documentação: https://restful-booker.herokuapp.com/apidoc/index.html
 *
 * Observações sobre a API (comportamentos documentados pela própria Restful Booker):
 * - POST /booking retorna 200 (e não 201) ao criar uma reserva.
 * - DELETE /booking/:id retorna 201 ao excluir uma reserva.
 * - POST /auth com credenciais inválidas retorna 200 com { reason: 'Bad credentials' }.
 * - GET /ping retorna 201 quando a API está no ar.
 */
describe('Restful Booker API', () => {
  const p = pactum;
  const rep = SimpleReporter;
  const baseUrl = 'https://restful-booker.herokuapp.com';

  // Credenciais padrão fornecidas pela documentação da API
  const usuarioAdmin = 'admin';
  const senhaAdmin = 'password123';
  const basicAuth = `Basic ${Buffer.from(`${usuarioAdmin}:${senhaAdmin}`).toString('base64')}`;

  // A API exige o header Accept para responder em JSON
  const headersPadrao = {
    Accept: 'application/json'
  };

  const formatarData = (data: Date) => data.toISOString().split('T')[0];

  const dataCheckin = faker.date.soon({ days: 30 });
  const dataCheckout = faker.date.soon({ days: 10, refDate: dataCheckin });

  // Massa de dados da reserva gerada dinamicamente com o Faker
  const reserva = {
    firstname: faker.person.firstName(),
    lastname: faker.person.lastName(),
    totalprice: faker.number.int({ min: 100, max: 2000 }),
    depositpaid: faker.datatype.boolean(),
    bookingdates: {
      checkin: formatarData(dataCheckin),
      checkout: formatarData(dataCheckout)
    },
    additionalneeds: faker.helpers.arrayElement(['Breakfast', 'Lunch', 'Dinner'])
  };

  // Schema JSON do objeto de reserva, reutilizado nas validações
  const schemaReserva = {
    type: 'object',
    properties: {
      firstname: { type: 'string' },
      lastname: { type: 'string' },
      totalprice: { type: 'number' },
      depositpaid: { type: 'boolean' },
      bookingdates: {
        type: 'object',
        properties: {
          checkin: { type: 'string' },
          checkout: { type: 'string' }
        },
        required: ['checkin', 'checkout']
      },
      additionalneeds: { type: 'string' }
    },
    required: ['firstname', 'lastname', 'totalprice', 'depositpaid', 'bookingdates']
  };

  let token = '';
  let bookingId = 0;

  p.request.setDefaultTimeout(90000);

  beforeAll(() => {
    p.reporter.add(rep);
  });

  // Antes de cada teste gera um token válido, usado nas operações que exigem autenticação
  beforeEach(async () => {
    token = await p
      .spec()
      .post(`${baseUrl}/auth`)
      .withHeaders(headersPadrao)
      .withJson({
        username: usuarioAdmin,
        password: senhaAdmin
      })
      .expectStatus(StatusCodes.OK)
      .expectJsonSchema({
        type: 'object',
        properties: {
          token: { type: 'string' }
        },
        required: ['token']
      })
      .returns('token');
  });

  describe('Health check', () => {
    it('Deve confirmar que a API está no ar através do endpoint /ping', async () => {
      await p
        .spec()
        .get(`${baseUrl}/ping`)
        .expectStatus(StatusCodes.CREATED)
        .expectBodyContains('Created');
    });
  });

  describe('Autenticação', () => {
    it('Não deve gerar token quando as credenciais forem inválidas', async () => {
      await p
        .spec()
        .post(`${baseUrl}/auth`)
        .withHeaders(headersPadrao)
        .withJson({
          username: faker.internet.username(),
          password: faker.internet.password()
        })
        .expectStatus(StatusCodes.OK)
        .expectJson({
          reason: 'Bad credentials'
        });
    });
  });

  describe('Reservas', () => {
    it('Deve cadastrar uma nova reserva e retornar o id com os dados enviados', async () => {
      bookingId = await p
        .spec()
        .post(`${baseUrl}/booking`)
        .withHeaders(headersPadrao)
        .withJson(reserva)
        .expectStatus(StatusCodes.OK)
        .expectJsonSchema({
          type: 'object',
          properties: {
            bookingid: { type: 'number' },
            booking: schemaReserva
          },
          required: ['bookingid', 'booking']
        })
        .expectJsonLike({
          booking: reserva
        })
        .returns('bookingid');
    });

    it('Deve buscar a reserva cadastrada pelo id', async () => {
      await p
        .spec()
        .get(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withHeaders(headersPadrao)
        .expectStatus(StatusCodes.OK)
        .expectJsonSchema(schemaReserva)
        .expectJsonLike(reserva);
    });

    it('Deve encontrar a reserva cadastrada ao filtrar por nome e sobrenome', async () => {
      await p
        .spec()
        .get(`${baseUrl}/booking`)
        .withQueryParams({
          firstname: reserva.firstname,
          lastname: reserva.lastname
        })
        .withHeaders(headersPadrao)
        .expectStatus(StatusCodes.OK)
        .expectJsonLike([{ bookingid: bookingId }]);
    });

    it('Deve atualizar todos os dados da reserva (PUT) utilizando token no cookie', async () => {
      const reservaAtualizada = {
        ...reserva,
        firstname: faker.person.firstName(),
        totalprice: faker.number.int({ min: 2001, max: 5000 }),
        additionalneeds: 'Late checkout'
      };

      await p
        .spec()
        .put(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withHeaders(headersPadrao)
        .withCookies('token', token)
        .withJson(reservaAtualizada)
        .expectStatus(StatusCodes.OK)
        .expectJsonSchema(schemaReserva)
        .expectJsonLike(reservaAtualizada);
    });

    it('Deve atualizar parcialmente a reserva (PATCH) utilizando Basic Auth', async () => {
      const dadosParciais = {
        firstname: faker.person.firstName(),
        lastname: faker.person.lastName()
      };

      await p
        .spec()
        .patch(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withHeaders(headersPadrao)
        .withHeaders('Authorization', basicAuth)
        .withJson(dadosParciais)
        .expectStatus(StatusCodes.OK)
        .expectJsonLike(dadosParciais);
    });

    it('Não deve permitir atualizar a reserva sem token de autenticação', async () => {
      await p
        .spec()
        .put(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withHeaders(headersPadrao)
        .withJson(reserva)
        .expectStatus(StatusCodes.FORBIDDEN)
        .expectBodyContains('Forbidden');
    });

    it('Deve retornar 404 ao buscar uma reserva inexistente', async () => {
      await p
        .spec()
        .get(`${baseUrl}/booking/{id}`)
        .withPathParams('id', 999999999)
        .withHeaders(headersPadrao)
        .expectStatus(StatusCodes.NOT_FOUND)
        .expectBodyContains('Not Found');
    });

    it('Deve excluir a reserva e não encontrá-la mais na busca', async () => {
      await p
        .spec()
        .delete(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withCookies('token', token)
        .expectStatus(StatusCodes.CREATED)
        .expectBodyContains('Created');

      await p
        .spec()
        .get(`${baseUrl}/booking/{id}`)
        .withPathParams('id', bookingId)
        .withHeaders(headersPadrao)
        .expectStatus(StatusCodes.NOT_FOUND);
    });
  });

  afterAll(() => p.reporter.end());
});