package com.example.constructiontracker.controller;

import com.example.constructiontracker.dto.SummaryResponse;
import com.example.constructiontracker.service.SummaryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/summary")
public class SummaryController {
    private final SummaryService service;

    public SummaryController(SummaryService service) {
        this.service = service;
    }

    @GetMapping
    public SummaryResponse summary(@RequestParam(required = false) String asOf) {
        return service.summary(asOf);
    }
}
