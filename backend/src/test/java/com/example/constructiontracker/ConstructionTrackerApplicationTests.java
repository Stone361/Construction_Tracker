package com.example.constructiontracker;

import com.example.constructiontracker.mapper.MyBatisSmokeMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ConstructionTrackerApplicationTests {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private MyBatisSmokeMapper myBatisSmokeMapper;

    @Test
    void myBatisLoadsXmlAndBindsParameters() {
        assertThat(myBatisSmokeMapper.selectValue(21)).isEqualTo(21);
        assertThat(myBatisSmokeMapper.selectValue(42)).isEqualTo(42);
    }

    @Test
    void applicationStartsAndReportsHealthy() {
        ResponseEntity<JsonNode> response = restTemplate.getForEntity("/actuator/health", JsonNode.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().path("status").asText()).isEqualTo("UP");
    }
}
