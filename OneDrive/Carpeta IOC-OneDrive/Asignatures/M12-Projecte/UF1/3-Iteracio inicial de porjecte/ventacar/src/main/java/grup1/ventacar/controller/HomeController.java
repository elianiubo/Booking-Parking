/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package grup1.ventacar.controller;

import ch.qos.logback.core.model.Model;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 *
 * @author elian
 */
@Controller

public class HomeController {
     @GetMapping("/")
    public String home(Model model) {
        // Puedes agregar atributos al modelo si los necesitas en tu JSP
       
        return "index"; // El nombre de la vista sin la extensión .jsp
    }
    
}
